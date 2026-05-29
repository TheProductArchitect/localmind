import { nanoid } from "nanoid";
import { getProvider } from "../providers";
import type { ChatMessage } from "../providers/types";
import { listAllTools } from "../tools";
import type { Tool } from "../tools/types";
import { buildSystemPrompt } from "./system-prompt";
import { classify } from "./permission-guard";
import { logStart, logComplete } from "./audit-logger";
import { awaitConfirmation } from "./confirmations";
import {
  addMessage, getMessages, getSettings, updateConversation, deleteTrailingTurn, getConversation,
} from "../db/queries";
import { approxTokens } from "../utils";

export type SSEEvent =
  | { type: "text_chunk"; delta: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; status: string; input: any }
  | { type: "tool_call_result"; toolCallId: string; status: string; output: string }
  | { type: "confirmation_required"; toolCallId: string; actionType: string; preview: string; timeoutSeconds: number; requiresPin: boolean }
  | { type: "confirmation_timeout"; toolCallId: string }
  | { type: "done"; conversationId: string; title: string; tokenCount: number }
  | { type: "context_compressed" }
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
  opts?: { regenerate?: boolean; channelMode?: boolean; systemPrefix?: string }
): AsyncGenerator<SSEEvent> {
  const settings = getSettings();
  if (!settings.active_model) {
    yield { type: "error", message: "No AI model is selected. Pull a model from the Model Manager first.", code: "no_model" };
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
  const toolMap = new Map<string, Tool>(allTools.map((t) => [t.definition.name, t]));
  const toolDefs = allTools.map((t) => t.definition);
  let totalTokens = 0;
  let assistantText = "";
  let contextCompressed = false;
  let toolCallCount = 0;

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

  try {
    if (contextCompressed) yield { type: "context_compressed" };
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) return;

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
          const timeoutMs = call.name === "browser" ? BROWSER_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;
          const result = await withTimeout(
            tool.execute(call.arguments, {
              conversationId,
              approvedDirs: JSON.parse(settings.approved_dirs || "[]"),
            }),
            timeoutMs,
            `Tool "${call.name}"`
          );
          logComplete(
            auditId,
            result.ok ? "allowed" : "failed",
            result.summary || result.output.slice(0, 200)
          );
          messages.push({
            role: "tool",
            content: result.output,
            tool_call_id: call.id,
            name: call.name,
          });
          addMessage({
            conversation_id: conversationId,
            role: "tool",
            content: JSON.stringify({
              id: call.id, name: call.name, output: result.output,
              status: result.ok ? "allowed" : "failed", input: call.arguments,
            }),
            token_count: 0,
            parent_message_id: null,
          });
          yield {
            type: "tool_call_result",
            toolCallId: call.id,
            status: result.ok ? "success" : "failed",
            output: result.summary || result.output.slice(0, 500),
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
    if (signal.aborted) return;
    yield {
      type: "error",
      message: "Something went wrong while generating a response. Check that Ollama is running.",
      code: "agent_error",
    };
  }
}

export { nanoid };

// Runs the agent and collects the final text — used by non-streaming channels.
export async function runAgentCollect(
  conversationId: string,
  message: string,
  opts?: { systemPrefix?: string }
): Promise<string> {
  const controller = new AbortController();
  let text = "";
  for await (const ev of runAgent(conversationId, message, controller.signal, {
    channelMode: true,
    systemPrefix: opts?.systemPrefix,
  })) {
    if (ev.type === "text_chunk") text += ev.delta;
    if (ev.type === "error") return ev.message;
  }
  return text.trim() || "(no response)";
}
