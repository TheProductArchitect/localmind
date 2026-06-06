import { nanoid } from "nanoid";
import { getProvider } from "../providers";
import type { ChatMessage } from "../providers/types";
import { listAllTools } from "../tools";
import type { Tool } from "../tools/types";
import { buildSystemPrompt } from "./system-prompt";
import { classify } from "./permission-guard";
import { logStart, logComplete } from "./audit-logger";
import { sanitizeToolOutput, isUntrustedTool } from "./sanitize-tool-output";
import { awaitConfirmation } from "./confirmations";
import {
  addMessage, getMessages, getSettings, updateConversation, deleteTrailingTurn, getConversation,
} from "../db/queries";
import { approxTokens } from "../utils";
import { startProcess, updateProcess, completeProcess } from "../db/agent-processes";
import { unregisterProcess } from "./process-registry";

// Best-effort orchestration hooks — orchestration writes must never crash the agent loop.
function safeProcessHook(fn: () => void): void {
  try { fn(); } catch (e) { console.warn("[orchestration] hook failed", (e as Error).message); }
}

export type SSEEvent =
  | { type: "text_chunk"; delta: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; status: string; input: any }
  | { type: "tool_call_result"; toolCallId: string; status: string; output: string }
  | { type: "confirmation_required"; toolCallId: string; actionType: string; preview: string; timeoutSeconds: number; requiresPin: boolean }
  | { type: "confirmation_timeout"; toolCallId: string }
  | { type: "done"; conversationId: string; title: string; tokenCount: number }
  | { type: "context_compressed" }
  | { type: "loop_suspended"; tool: string; repeats: number; reason: string }
  | { type: "error"; message: string; code: string };

const MAX_ITERATIONS = 12;
const CONFIRM_TIMEOUT_MS = 60_000;
// Hard ceiling on tool executions per response — bounds a looping or runaway agent.
const MAX_TOOL_CALLS = 25;
const TOOL_TIMEOUT_MS = 30_000;
const BROWSER_TOOL_TIMEOUT_MS = 60_000;

// Per-model context window sizes (token estimates). Used only as a fallback when
// the user has not set an explicit context window (context_window = 0 / "auto").
const CONTEXT_WINDOWS: Record<string, number> = {
  "llama3.2": 8192, "llama3.1": 8192, "llama3": 8192, "llama2": 4096,
  "qwen2.5-coder": 32768, "qwen2.5": 32768, "mistral": 8192, "phi3.5": 4096,
  "gpt-4o": 128000, "gpt-4o-mini": 128000,
};

// Sensible large default for unrecognised models — sized for local coding work
// rather than collapsing to a tiny window.
const DEFAULT_CONTEXT_WINDOW = 32768;

function contextWindowFor(model: string): number {
  for (const [key, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (model.toLowerCase().includes(key)) return size;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

// Resolve the effective context window: prefer the user-configured value, and
// fall back to the per-model table only when no explicit value is set.
function resolveContextWindow(configured: number | null | undefined, model: string): number {
  if (configured && configured > 0) return configured;
  return contextWindowFor(model);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);
}

export async function* runAgent(
  conversationId: string,
  userMessage: string,
  signal: AbortSignal,
  opts?: {
    regenerate?: boolean;
    channelMode?: boolean;
    systemPrefix?: string;
    /** Merged into the spawned agent_processes row's metadata. Used by
     *  spawn_subagent / spawn_subagents_parallel to tag children with
     *  { kind: "subagent", batch_size, free_ram_gb_at_start }. */
    processMetadata?: Record<string, unknown>;
    /** Overrides the default display name (first user message) — useful for
     *  subagents which want descriptive labels in the orchestration page. */
    processDisplayName?: string;
    /** Whitelist of tool NAMES this agent may see. Used to give spawned
     *  subagents a narrow surface — the persona's enabled_tools intersected
     *  with the caller-specified allowed_tools. Tools outside this set are
     *  hidden from the LLM's tool definitions AND refused at dispatch. The
     *  `request_tool_access` tool is auto-added so a subagent can ask for
     *  more access when stuck. Undefined = full registry (the main Sora chat). */
    allowedTools?: readonly string[];
  }
): AsyncGenerator<SSEEvent> {
  const settings = getSettings();
  if (!settings.active_model) {
    yield { type: "error", message: "No AI model is selected. Pull a model from the Model Manager first.", code: "no_model" };
    return;
  }

  // V6.10 loop-guard: if this conversation was previously suspended for
  // looping behaviour, refuse to start until the user explicitly resumes.
  // This is structurally enforced — the model can't talk past it because
  // it's checked before any LLM call happens.
  const { isSuspended } = await import("./loop-guard");
  const suspendCheck = isSuspended(conversationId);
  if (suspendCheck.suspended) {
    yield {
      type: "loop_suspended",
      tool: suspendCheck.tool ?? "(unknown)",
      repeats: suspendCheck.repeats ?? 0,
      reason: suspendCheck.reason ?? "Conversation was suspended due to a tool-call loop.",
    };
    return;
  }

  if (opts?.regenerate) {
    // Drop the previous answer so the last user message is re-answered.
    deleteTrailingTurn(conversationId);
  } else {
    addMessage({
      conversation_id: conversationId,
      role: "user",
      content: userMessage,
      token_count: approxTokens(userMessage),
      parent_message_id: null,
    });
  }

  // Build message history
  const history = getMessages(conversationId);
  const convOwner = getConversation(conversationId)?.owner_user_id || undefined;
  const systemContent =
    (opts?.systemPrefix ? opts.systemPrefix + "\n\n" : "") + buildSystemPrompt(convOwner);
  const messages: ChatMessage[] = [{ role: "system", content: systemContent }];
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    } else if (m.role === "tool") {
      try {
        const parsed = JSON.parse(m.content);
        messages.push({ role: "tool", content: parsed.output, tool_call_id: parsed.id, name: parsed.name });
      } catch {}
    }
  }

  const provider = getProvider();
  const allTools = await listAllTools();
  // Subagents get a narrow tool surface. The `request_tool_access` tool is
  // always added to that surface so a stuck subagent can ask the parent for
  // more — see src/lib/tools/request-tool-access.ts. The main Sora chat
  // (no allowedTools restriction) sees the full registry.
  const allowedSet = opts?.allowedTools
    ? new Set<string>([...opts.allowedTools, "request_tool_access"])
    : null;
  const visibleTools = allowedSet
    ? allTools.filter((t) => allowedSet.has(t.definition.name))
    : allTools;
  const toolMap = new Map<string, Tool>(visibleTools.map((t) => [t.definition.name, t]));
  const toolDefs = visibleTools.map((t) => t.definition);
  let totalTokens = 0;
  let assistantText = "";
  let contextCompressed = false;
  let toolCallCount = 0;

  // ---- Orchestration: register this chat as an agent process. ----
  const firstUserText = history.find((m) => m.role === "user")?.content || userMessage;
  const processDisplay = opts?.processDisplayName || firstUserText.slice(0, 80).replace(/\s+/g, " ").trim() || "Chat";
  // Subagent spawns pass metadata with `kind: "subagent"` etc. The kind drives
  // both the process_type used here AND the agent_name shown in the
  // orchestration page, so the same field controls every downstream classifier.
  const spawnedKind = (opts?.processMetadata as { kind?: string } | undefined)?.kind;
  const isSubagent = spawnedKind === "subagent";
  const subagentPersonaId =
    (opts?.processMetadata as { persona_id?: string } | undefined)?.persona_id ?? null;
  const subagentStartedAt = Date.now();
  let processId = "";
  safeProcessHook(() => {
    processId = startProcess({
      process_type: isSubagent ? "long_running_job" : "chat",
      display_name: processDisplay,
      owner_user_id: convOwner || null,
      agent_name: isSubagent ? "Subagent" : "Main",
      persona_id: subagentPersonaId ?? "persona-general",
      metadata: {
        conversation_id: conversationId,
        model: settings.active_model,
        ...(opts?.processMetadata ?? {}),
      },
    });
  });

  // Context window overflow prevention — compress old turns if the history is large.
  const ctxWindow = resolveContextWindow(settings.context_window, settings.active_model);
  const estTokens = messages.reduce((s, m) => s + approxTokens((m as any).content || ""), 0);
  if (estTokens > ctxWindow * 0.8 && messages.length > 6) {
    try {
      const cutoff = 1 + Math.floor((messages.length - 1) * 0.6);
      const toSummarise = messages.slice(1, cutoff);
      const transcript = toSummarise
        .map((m) => `${m.role}: ${((m as any).content || "").slice(0, 1500)}`)
        .join("\n");
      let summary = "";
      for await (const d of getProvider().chat({
        model: settings.active_model,
        messages: [
          { role: "system", content: "Summarise the conversation below in 200-400 words, preserving key facts, decisions, and any file paths." },
          { role: "user", content: transcript },
        ],
        tools: [],
        signal,
        contextWindow: ctxWindow,
      })) {
        if (d.type === "text") summary += d.delta;
      }
      messages.splice(1, cutoff - 1, {
        role: "assistant",
        content: "Summary of earlier conversation: " + summary.trim(),
      });
      contextCompressed = true;
    } catch {
      /* compression is best-effort — proceed with full history if it fails */
    }
  }

  let processOutcome: "completed" | "failed" | "cancelled" = "completed";

  try {
    if (contextCompressed) yield { type: "context_compressed" };
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) { processOutcome = "cancelled"; return; }
      safeProcessHook(() => updateProcess(processId, { current_step: `Iteration ${iter + 1}` }));

      let iterText = "";
      const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

      for await (const delta of provider.chat({
        model: settings.active_model,
        messages,
        tools: toolDefs,
        signal,
        contextWindow: ctxWindow,
      })) {
        if (signal.aborted) return;
        if (delta.type === "text") {
          iterText += delta.delta;
          assistantText += delta.delta;
          totalTokens += approxTokens(delta.delta);
          yield { type: "text_chunk", delta: delta.delta };
        } else if (delta.type === "tool_call") {
          toolCalls.push(delta.call);
        }
      }

      if (toolCalls.length === 0) {
        // Text-only response: loop ends
        if (iterText.trim()) {
          messages.push({ role: "assistant", content: iterText });
        }
        break;
      }

      // Record assistant turn with tool calls
      messages.push({ role: "assistant", content: iterText, tool_calls: toolCalls });

      for (const call of toolCalls) {
        if (signal.aborted) return;
        // Hard tool-call budget — stops a looping or runaway agent.
        if (toolCallCount >= MAX_TOOL_CALLS) {
          yield {
            type: "error",
            message: `This response reached the safety limit of ${MAX_TOOL_CALLS} tool calls and was stopped. Ask me to continue if you still need more.`,
            code: "tool_budget_exceeded",
          };
          return;
        }
        toolCallCount++;
        const tool = toolMap.get(call.name);
        if (!tool) {
          messages.push({
            role: "tool",
            content: `Tool "${call.name}" does not exist.`,
            tool_call_id: call.id,
            name: call.name,
          });
          yield { type: "tool_call_result", toolCallId: call.id, status: "failed", output: "Unknown tool" };
          continue;
        }

        const actionType = tool.classify ? tool.classify(call.arguments) : tool.actionType;
        const preview = tool.preview ? tool.preview(call.arguments) : JSON.stringify(call.arguments);

        yield {
          type: "tool_call_start",
          toolCallId: call.id,
          toolName: call.name,
          status: preview,
          input: call.arguments,
        };

        const tier = tool.forcedTier || classify(actionType);
        let approvedBy: "user" | "auto" | "rule" = "auto";
        let allowed = true;

        if (tier === "ask" || tier === "pin") {
          if (opts?.channelMode) {
            // No interactive UI on this channel — sensitive actions are refused.
            allowed = false;
            approvedBy = "rule";
          } else {
            safeProcessHook(() => updateProcess(processId, {
              status: "waiting_confirmation",
              current_step: `Waiting for confirmation on ${actionType}`,
            }));
            yield {
              type: "confirmation_required",
              toolCallId: call.id,
              actionType,
              preview,
              timeoutSeconds: 60,
              requiresPin: tier === "pin",
            };
            const decision = await awaitConfirmation(call.id, CONFIRM_TIMEOUT_MS, tier === "pin");
            allowed = decision === "allow";
            approvedBy = "user";
            if (!allowed) {
              yield { type: "confirmation_timeout", toolCallId: call.id };
            }
            safeProcessHook(() => updateProcess(processId, { status: "running" }));
          }
        }

        // delete_files always goes through ask regardless (handled by tier above being ask/pin in profiles)

        const auditId = logStart({
          actionType,
          toolName: call.name,
          input: call.arguments,
          conversationId,
          approvedBy,
        });

        if (!allowed) {
          logComplete(auditId, "denied", "User denied or confirmation timed out");
          const msg = `Action denied by the user: ${preview}`;
          messages.push({ role: "tool", content: msg, tool_call_id: call.id, name: call.name });
          addMessage({
            conversation_id: conversationId,
            role: "tool",
            content: JSON.stringify({ id: call.id, name: call.name, output: msg, status: "denied" }),
            token_count: 0,
            parent_message_id: null,
          });
          yield { type: "tool_call_result", toolCallId: call.id, status: "denied", output: msg };
          continue;
        }

        try {
          // V6.10 loop guard — check BEFORE dispatching. If this exact
          // (tool, input) has fired MAX_REPEATS times within the window,
          // suspend the conversation and bail out. The check is cheap
          // (one DB read + a small in-memory ring buffer).
          const { checkAndRecord } = await import("./loop-guard");
          const loopCheck = checkAndRecord({
            conversation_id: conversationId,
            tool_name: call.name,
            input: call.arguments,
          });
          if (!loopCheck.ok) {
            logComplete(auditId, "denied", `Loop guard tripped: ${loopCheck.reason}`);
            yield {
              type: "loop_suspended",
              tool: loopCheck.tool,
              repeats: loopCheck.repeats,
              reason: loopCheck.reason,
            };
            // End the generator — the suspension persists in the DB and
            // a future runAgent on this conversation will hit the boot
            // check at the top of this function until the user resumes.
            return;
          }

          const timeoutMs = call.name === "browser" ? BROWSER_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;
          // V6.7: route through the tool-call cache wrapper so idempotent
          // reads (web_search, knowledge.search, memory.read, filesystem.read,
          // etc.) return cached output when (tool_name, tool_version,
          // input_hash) is a known good match. Side-effectful ops and tools
          // that don't opt in via `cacheable()` go straight through.
          const { executeWithCache } = await import("./tool-cache-wrapper");
          const result = await withTimeout(
            executeWithCache(tool, call.arguments, {
              conversationId,
              approvedDirs: JSON.parse(settings.approved_dirs || "[]"),
            }),
            timeoutMs,
            `Tool "${call.name}"`
          );
          // Sanitize tool output before it enters the model context. For
          // tools that gather content from outside LocalMind (web_search,
          // browser, peer_knowledge, MCP outputs, email-read), wrap the
          // body in <untrusted_content> tags, detect injection patterns,
          // cap size, and neutralise chat-template tokens. Trusted tool
          // outputs just get size-capped.
          const sanitized = sanitizeToolOutput(call.name, result.output);
          if (sanitized.detected.length > 0) {
            // Record the injection attempt in the audit log so the user
            // can see what tried to get through.
            logComplete(
              auditId,
              result.ok ? "allowed" : "failed",
              `[injection-detected:${sanitized.detected.join(",")}] ` +
                (result.summary || result.output.slice(0, 160))
            );
          } else {
            logComplete(
              auditId,
              result.ok ? "allowed" : "failed",
              result.summary || result.output.slice(0, 200)
            );
          }
          messages.push({
            role: "tool",
            content: sanitized.output,
            tool_call_id: call.id,
            name: call.name,
          });
          addMessage({
            conversation_id: conversationId,
            role: "tool",
            content: JSON.stringify({
              id: call.id, name: call.name, output: sanitized.output,
              status: result.ok ? "allowed" : "failed", input: call.arguments,
              // Preserve the security metadata so the UI can flag it.
              untrusted: isUntrustedTool(call.name),
              injection_detected: sanitized.detected,
              truncated: sanitized.truncated,
            }),
            token_count: 0,
            parent_message_id: null,
          });
          yield {
            type: "tool_call_result",
            toolCallId: call.id,
            status: result.ok ? "success" : "failed",
            output: result.summary || sanitized.output.slice(0, 500),
          };
        } catch (e: any) {
          logComplete(auditId, "failed", e?.message || "execution error");
          const msg = `The tool failed to run: ${e?.message || "unknown error"}`;
          messages.push({ role: "tool", content: msg, tool_call_id: call.id, name: call.name });
          yield { type: "tool_call_result", toolCallId: call.id, status: "failed", output: msg };
        }
      }
    }

    // Persist final assistant message
    if (assistantText.trim()) {
      addMessage({
        conversation_id: conversationId,
        role: "assistant",
        content: assistantText,
        token_count: approxTokens(assistantText),
        parent_message_id: null,
      });
    }

    // Generate title from first user message if still default
    const history2 = getMessages(conversationId);
    const firstUser = history2.find((m) => m.role === "user");
    let title = "New conversation";
    if (firstUser) {
      title = firstUser.content.slice(0, 60).replace(/\n/g, " ").trim() || "New conversation";
    }
    updateConversation(conversationId, { title });

    yield { type: "done", conversationId, title, tokenCount: totalTokens };
  } catch (e: any) {
    processOutcome = signal.aborted ? "cancelled" : "failed";
    if (signal.aborted) return;
    yield {
      type: "error",
      message: "Something went wrong while generating a response. Check that Ollama is running.",
      code: "agent_error",
    };
  } finally {
    safeProcessHook(() => {
      completeProcess(processId, processOutcome);
      unregisterProcess(processId);
    });
    if (isSubagent && subagentPersonaId && processId) {
      try {
        const { shouldReview, enqueueIfWorthwhile } = await import("./critic");
        const decision = shouldReview({
          status: processOutcome,
          duration_ms: Date.now() - subagentStartedAt,
          persona_id: subagentPersonaId,
        });
        if (decision.review) {
          enqueueIfWorthwhile({
            process_id: processId,
            persona_id: subagentPersonaId,
            reason: decision.reason,
          });
        }
      } catch {
        /* critic enqueue is best-effort */
      }
    }
  }
}

export { nanoid };

// Runs the agent and collects the final text — used by non-streaming channels.
export async function runAgentCollect(
  conversationId: string,
  message: string,
  opts?: {
    systemPrefix?: string;
    /** Optional metadata merged into the agent_processes row created for this
     *  run. Used by subagent.ts to tag spawned children with
     *  { kind: "subagent", batch_size, free_ram_gb_at_start } so the analytics
     *  rollup can attribute work to its spawn pattern. */
    processMetadata?: Record<string, unknown>;
    /** Optional display name for the spawned agent_processes row. Useful for
     *  the orchestration page to distinguish "Subagent (research)" from
     *  "Subagent (writer)". */
    processDisplayName?: string;
    /** Tool-name whitelist enforced at dispatch. See runAgent for semantics. */
    allowedTools?: readonly string[];
  }
): Promise<string> {
  const controller = new AbortController();
  let text = "";
  for await (const ev of runAgent(conversationId, message, controller.signal, {
    channelMode: true,
    systemPrefix: opts?.systemPrefix,
    processMetadata: opts?.processMetadata,
    processDisplayName: opts?.processDisplayName,
    allowedTools: opts?.allowedTools,
  })) {
    if (ev.type === "text_chunk") text += ev.delta;
    if (ev.type === "error") return ev.message;
  }
  return text.trim() || "(no response)";
}
