import { nanoid } from "nanoid";
import { getProviderByName } from "../providers";
import type { ChatMessage } from "../providers/types";
import { listAllTools } from "../tools";
import type { Tool } from "../tools/types";
import { buildSystemPrompt } from "./system-prompt";
import { classify } from "./permission-guard";
import { logStart, logComplete } from "./audit-logger";
import { sanitizeToolOutput, isUntrustedTool } from "./sanitize-tool-output";
import { awaitConfirmation } from "./confirmations";
import {
  addMessage, getMessages, getSettings, updateSettings, updateConversation, deleteTrailingTurn, getConversation,
} from "../db/queries";
import { approxTokens } from "../utils";
import { startProcess, updateProcess, completeProcess, type Pillar } from "../db/agent-processes";
import { classifyPillar } from "./pillar-classify";
import { parseTextToolCalls } from "./text-tool-calls";
import { splitHistory, recentWindowSize } from "./history-context";
import { ensureConversationSummary } from "./history-summary";
import { getConversationSummary } from "../db/conversation-summary";
import { buildConversationMessages } from "./conversation-messages";
import { unregisterProcess } from "./process-registry";
import { resolveRoutedModel } from "./routing";
import { isTrivialUserTurn } from "./trivial-turn";
import { pickPreferredOllamaModel } from "../curated-models";

// Best-effort orchestration hooks — orchestration writes must never crash the agent loop.
function safeProcessHook(fn: () => void): void {
  try { fn(); } catch (e) { console.warn("[orchestration] hook failed", (e as Error).message); }
}

export type SSEEvent =
  | { type: "status"; phase: string; detail?: string }
  | { type: "text_chunk"; delta: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; status: string; input: any }
  | { type: "tool_call_result"; toolCallId: string; status: string; output: string; summary?: string }
  | { type: "confirmation_required"; toolCallId: string; actionType: string; preview: string; timeoutSeconds: number; requiresPin: boolean }
  | { type: "confirmation_timeout"; toolCallId: string }
  | { type: "done"; conversationId: string; title: string; tokenCount: number }
  | { type: "context_compressed" }
  | { type: "loop_suspended"; tool: string; repeats: number; reason: string }
  | { type: "tool_text_recovered" }
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
    channelKey?: string;
    /** Merged into the spawned agent_processes row's metadata. Used by
     *  spawn_subagent / spawn_subagents_parallel to tag children with
     *  { kind: "subagent", batch_size, free_ram_gb_at_start }. */
    processMetadata?: Record<string, unknown>;
    /** Overrides the default display name (first user message) — useful for
     *  subagents which want descriptive labels in the orchestration page. */
    processDisplayName?: string;
    allowedTools?: readonly string[];
    /** When set, use this model instead of the routed/default model. */
    modelPreference?: string | null;
    /** When set, use this provider instead of the routed/default provider. */
    providerPreference?: string | null;
    /** Image attachments for a multimodal user turn ({ name, mime, data(base64) }). */
    images?: { name?: string; mime: string; data: string }[];
    /** Bind tools to a coding session worktree for the whole turn. */
    codingSessionId?: string | null;
  }
): AsyncGenerator<SSEEvent> {
  // First yield before any I/O so the UI can leave "blank" immediately.
  yield { type: "status", phase: "preparing", detail: "Starting…" };

  const settings = getSettings();
  const conv = getConversation(conversationId);
  const trivial = !opts?.allowedTools && !opts?.regenerate && isTrivialUserTurn(userMessage);
  const routed = resolveRoutedModel(
    userMessage,
    settings.active_model,
    (opts?.processMetadata as { persona_id?: string } | undefined)?.persona_id,
    settings.provider
  );
  // Precedence: opts → per-conversation override → routing/persona → settings
  const activeProvider =
    opts?.providerPreference ||
    conv?.model_provider ||
    routed.provider ||
    settings.provider ||
    "ollama";
  let activeModel =
    opts?.modelPreference ||
    conv?.model_name ||
    routed.model ||
    settings.active_model;
  // First-run / empty settings: adopt an already-installed Ollama model instead of
  // forcing a re-download through Model Manager.
  if (!activeModel && (activeProvider === "ollama" || !activeProvider)) {
    try {
      const installed = await getProviderByName("ollama").getModels();
      const picked = pickPreferredOllamaModel(installed);
      if (picked) {
        activeModel = picked;
        try {
          updateSettings({ active_model: picked, provider: "ollama" });
        } catch {
          /* settings write is best-effort */
        }
      }
    } catch {
      /* Ollama unreachable — fall through to no_model */
    }
  }
  if (!activeModel) {
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
      attachments: opts?.images?.length ? JSON.stringify(opts.images) : null,
    });
  }

  // Build message history via the shared builder (also used by the idle
  // summary precompute, so covered_count stays consistent between them).
  const convOwner = getConversation(conversationId)?.owner_user_id || undefined;
  const systemContent =
    (opts?.systemPrefix ? opts.systemPrefix + "\n\n" : "") + buildSystemPrompt(convOwner);
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...buildConversationMessages(conversationId),
  ];

  const provider = getProviderByName(activeProvider);
  let allTools: Tool[] = [];
  if (trivial) {
    // Greetings/acks: skip the tool registry entirely so the model cannot
    // invent a `time` / web call and double the round-trip.
    yield { type: "status", phase: "thinking", detail: "Replying…" };
  } else {
    yield { type: "status", phase: "preparing", detail: "Loading tools…" };
    allTools = await listAllTools();
  }
  // Subagents get a narrow tool surface. The `request_tool_access` tool is
  // always added to that surface so a stuck subagent can ask the parent for
  // more — see src/lib/tools/request-tool-access.ts. The main Sora chat
  // (no allowedTools restriction) sees the full registry — do not hide tools
  // here based on prompt state; small models improve with better models /
  // routing, not by hardcoding away capabilities.
  const allowedSet = opts?.allowedTools
    ? new Set<string>([...opts.allowedTools, "request_tool_access"])
    : null;
  // request_tool_access is the subagent escape hatch. Main chat already has
  // the full registry — leaving it visible causes small models to "ask
  // permission" instead of answering or calling the real tools.
  const visibleTools = trivial
    ? []
    : allowedSet
      ? allTools.filter((t) => allowedSet.has(t.definition.name))
      : allTools.filter((t) => t.definition.name !== "request_tool_access");
  const toolMap = new Map<string, Tool>(visibleTools.map((t) => [t.definition.name, t]));
  const toolDefs = visibleTools.map((t) => t.definition);
  let totalTokens = 0;
  let assistantText = "";
  let contextCompressed = false;
  let toolCallCount = 0;

  // ---- Orchestration: register this chat as an agent process. ----
  const firstUserText =
    (messages.find((m) => m.role === "user")?.content as string | undefined) || userMessage;
  const processDisplay = opts?.processDisplayName || firstUserText.slice(0, 80).replace(/\s+/g, " ").trim() || "Chat";
  // Subagent spawns pass metadata with `kind: "subagent"` etc. The kind drives
  // both the process_type used here AND the agent_name shown in the
  // orchestration page, so the same field controls every downstream classifier.
  const spawnedKind = (opts?.processMetadata as { kind?: string } | undefined)?.kind;
  const isSubagent = spawnedKind === "subagent";
  const subagentPersonaId =
    (opts?.processMetadata as { persona_id?: string } | undefined)?.persona_id ?? null;
  const subagentStartedAt = Date.now();
  // Tag the process with the pillar it advances (§6) so the Ops board can
  // filter/group. Explicit metadata.pillar (e.g. idle "maintain" jobs) wins.
  const explicitPillar = (opts?.processMetadata as { pillar?: Pillar } | undefined)?.pillar;
  const pillar = explicitPillar ?? classifyPillar(firstUserText, subagentPersonaId);
  let processId = "";
  safeProcessHook(() => {
    processId = startProcess({
      process_type: isSubagent ? "long_running_job" : "chat",
      display_name: processDisplay,
      owner_user_id: convOwner || null,
      agent_name: isSubagent ? "Subagent" : "Main",
      persona_id: subagentPersonaId ?? "persona-general",
      pillar,
      metadata: {
        conversation_id: conversationId,
        model: activeModel,
        provider: activeProvider,
        ...(opts?.processMetadata ?? {}),
        ...(routed.matchedAgent ? { routed_agent: routed.matchedAgent, routing_rule_id: routed.ruleId } : {}),
      },
    });
  });

  // Intelligent history: use the last stored summary immediately (never block
  // the first token on a full LLM summarize). Refresh the summary in the
  // background when the covered window is behind.
  const ctxWindow = resolveContextWindow(settings.context_window, activeModel);
  try {
    const RECENT = recentWindowSize();
    const nonSystem = messages.slice(1);
    if (nonSystem.length > RECENT) {
      const { older, recent } = splitHistory(nonSystem, RECENT);
      if (older.length > 0) {
        const stored = getConversationSummary(conversationId);
        if (stored?.summary) {
          const sys = messages[0];
          const merged: ChatMessage = {
            ...sys,
            content:
              (sys.content || "") +
              "\n\n## Earlier conversation (summarized)\n" +
              stored.summary +
              "\n(Older messages aren't shown verbatim — call the `recall` tool to fetch specific past messages if you need a detail from earlier.)",
          };
          messages.length = 0;
          messages.push(merged, ...recent);
          contextCompressed = true;
        }
        if (!stored || (stored.covered_count ?? 0) < older.length) {
          void ensureConversationSummary(conversationId, older, {
            model: activeModel,
            signal,
            contextWindow: ctxWindow,
          }).catch(() => {});
        }
      }
    }
  } catch {
    /* history budgeting is best-effort — proceed with full history if it fails */
  }

  // Context Broker: skip on trivial turns; otherwise race retrieval against a
  // short deadline so a slow Ollama embed never stalls first-token latency.
  if (!trivial && !opts?.allowedTools && userMessage && userMessage.trim()) {
    try {
      yield { type: "status", phase: "preparing", detail: "Gathering context…" };
      const { retrieveContext } = await import("./context-broker");
      type BrokerRes = Awaited<ReturnType<typeof retrieveContext>>;
      const res = await Promise.race([
        retrieveContext({ query: userMessage, userId: convOwner }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 180)),
      ]);
      if (res && (res as BrokerRes).items?.length > 0) {
        const sys = messages[0];
        messages[0] = { ...sys, content: (sys.content || "") + "\n\n" + (res as BrokerRes).brief };
      }
    } catch {
      /* retrieval is best-effort — proceed without injected context */
    }
  }

  let processOutcome: "completed" | "failed" | "cancelled" = "completed";

  try {
    yield { type: "status", phase: "thinking" };
    if (contextCompressed) yield { type: "context_compressed" };
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) { processOutcome = "cancelled"; return; }
      safeProcessHook(() => updateProcess(processId, { current_step: `Iteration ${iter + 1}` }));

      let iterText = "";
      const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

      for await (const delta of provider.chat({
        model: activeModel,
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
        // Recovery: small models often narrate a tool call as raw JSON text
        // instead of emitting a structured call. If this "text-only" response
        // is really an attempted tool call, turn it back into one and run it
        // through the normal gated path below — otherwise the action never
        // happens and the JSON leaks to the user.
        const recovered = parseTextToolCalls(iterText, (n) => toolMap.has(n));
        if (recovered.length === 0) {
          // Genuine text response: loop ends.
          if (iterText.trim()) {
            messages.push({ role: "assistant", content: iterText });
          }
          break;
        }
        // Tell the client to drop the leaked JSON bubble; don't persist it.
        yield { type: "tool_text_recovered" };
        if (iterText && assistantText.endsWith(iterText)) {
          assistantText = assistantText.slice(0, -iterText.length);
        }
        toolCalls.push(...recovered);
        iterText = "";
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
        // Defense in depth: greetings must never pay for a tool round-trip
        // (especially `time`, which small models invent after "hello").
        if (isTrivialUserTurn(userMessage)) {
          const msg =
            `Skipped "${call.name}" — greetings and short acknowledgements do not need tools. Reply in plain text.`;
          messages.push({
            role: "tool",
            content: msg,
            tool_call_id: call.id,
            name: call.name,
          });
          yield { type: "tool_call_result", toolCallId: call.id, status: "denied", output: msg };
          continue;
        }
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
          if (opts?.channelMode && opts?.channelKey) {
            safeProcessHook(() => updateProcess(processId, {
              status: "waiting_confirmation",
              current_step: `Waiting for channel confirmation on ${actionType}`,
            }));
            yield {
              type: "confirmation_required",
              toolCallId: call.id,
              actionType,
              preview,
              timeoutSeconds: 120,
              requiresPin: false,
            };
            const channelType = opts.channelKey?.split(":")[0] || "browser";
            const { deliver } = await import("../workflow/deliver");
            const approvalMsg = `LocalMind needs approval:\n${preview}\n\nReply YES to approve or NO to deny.`;
            try {
              await deliver(channelType, approvalMsg);
            } catch {
              await deliver("browser", approvalMsg);
            }
            const decision = await awaitConfirmation(call.id, 120_000, false, {
              channelKey: opts.channelKey,
              preview,
            });
            allowed = decision === "allow";
            approvedBy = "user";
            if (!allowed) {
              yield { type: "confirmation_timeout", toolCallId: call.id };
            }
            safeProcessHook(() => updateProcess(processId, { status: "running" }));
          } else if (opts?.channelMode) {
            // No channel key — sensitive actions are refused.
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
          let approvedDirs: string[] = JSON.parse(settings.approved_dirs || "[]");
          const sessionFromArgs =
            typeof call.arguments?.coding_session_id === "string"
              ? call.arguments.coding_session_id
              : opts?.codingSessionId || null;
          if (sessionFromArgs) {
            try {
              const { sessionApprovedDirs } = await import("../coding/worktree");
              const overlay = sessionApprovedDirs(sessionFromArgs);
              if (overlay?.length) approvedDirs = overlay;
              // Ensure the model-visible args include the session id so tools
              // that read input.coding_session_id also see it.
              if (call.arguments && call.arguments.coding_session_id == null) {
                call.arguments = { ...call.arguments, coding_session_id: sessionFromArgs };
              }
            } catch { /* keep global approved dirs */ }
          }
          const result = await withTimeout(
            executeWithCache(tool, call.arguments, {
              conversationId,
              approvedDirs,
              codingSessionId: sessionFromArgs,
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
            // Prefer the real tool output for the chat card. Previously we
            // yielded only `summary`, which for spawn_subagent hid the child’s
            // answer behind a one-liner and left no structured metadata.
            output: sanitized.output.slice(0, 8_000),
            summary: result.summary,
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
    const detail = typeof e?.message === "string" ? e.message.trim() : "";
    // Surface the real provider/tool failure (e.g. "model 'X' not found") so
    // the UI doesn't collapse every crash into a reconnect loop.
    const message = /model .+ not found|ECONNREFUSED|fetch failed|Ollama/i.test(detail)
      ? detail
      : detail
        ? `Something went wrong while generating a response: ${detail}`
        : "Something went wrong while generating a response. Check that Ollama is running.";
    console.error("[agent] runAgent failed:", detail || e);
    yield {
      type: "error",
      message,
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
    processMetadata?: Record<string, unknown>;
    processDisplayName?: string;
    allowedTools?: readonly string[];
    /** Set by the graph runner to prevent recursive graph execution. */
    fromGraph?: boolean;
    modelPreference?: string | null;
    codingSessionId?: string | null;
  }
): Promise<string> {
  if (!opts?.fromGraph && process.env.LOCALMIND_USE_GRAPHS !== "0") {
    const { runCollectViaGraph } = await import("./graph-chat");
    return runCollectViaGraph(conversationId, message, opts);
  }

  const controller = new AbortController();
  let text = "";
  for await (const ev of runAgent(conversationId, message, controller.signal, {
    channelMode: true,
    channelKey: (opts?.processMetadata as { channel_key?: string } | undefined)?.channel_key,
    systemPrefix: opts?.systemPrefix,
    processMetadata: opts?.processMetadata,
    processDisplayName: opts?.processDisplayName,
    allowedTools: opts?.allowedTools,
    modelPreference: opts?.modelPreference,
    codingSessionId: opts?.codingSessionId,
  })) {
    if (ev.type === "text_chunk") text += ev.delta;
    if (ev.type === "error") return ev.message;
  }
  return text.trim() || "(no response)";
}
