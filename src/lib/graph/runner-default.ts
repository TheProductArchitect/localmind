/**
 * Default node runner — executes a node by invoking V5's agent engine.
 *
 * The runner is pluggable in the executor (see types.ts NodeRunner). V6.5 will
 * add a peer-RPC runner that forwards a node to another machine via
 * sendToPeer; tests inject a stub runner. This is the local single-machine
 * runner used by V6.3.
 *
 * Variable substitution: the AgentSpec.prompt_template can reference
 *   {input.X}         — values from node.input
 *   {parent.OUTPUT}   — outputs from parent nodes (keyed by their node_id)
 * Anything not matching either pattern is left in place.
 */

import { runAgentCollect } from "../agent/engine";
import { createConversation } from "../db/queries";
import { approxTokens } from "../utils";
import type { NodeRunner, NodeRunResult, RunnerContext, TaskNode } from "./types";

function substitute(template: string, input: Record<string, unknown>, parents: Record<string, unknown>): string {
  return template
    .replace(/\{input\.([A-Za-z0-9_]+)\}/g, (_, k) => stringify(input[k]))
    .replace(/\{parent\.([A-Za-z0-9_-]+)\}/g, (_, id) => stringify(parents[id]));
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Build a per-graph conversation ID lazily — the runner ctx caches one across
 * all node calls in a single executor pass so audit trail / token accounting
 * accumulates against one conversation per graph rather than one per node.
 */
function ensureConversation(ctx: RunnerContext): string {
  if (ctx.conversation_id) return ctx.conversation_id;
  const conv = createConversation();
  ctx.conversation_id = conv.id;
  return conv.id;
}

export const defaultRunner: NodeRunner = async (node: TaskNode, ctx: RunnerContext): Promise<NodeRunResult> => {
  const t0 = Date.now();
  const prompt = substitute(node.agent_spec.prompt_template, node.input, ctx.parent_outputs);
  const conversationId = ensureConversation(ctx);
  const systemPrefix = stringify(node.input.system_prefix) || undefined;

  try {
    const codingSessionId =
      (typeof node.input.coding_session_id === "string" && node.input.coding_session_id) ||
      (typeof (ctx as { coding_session_id?: string }).coding_session_id === "string"
        ? (ctx as { coding_session_id?: string }).coding_session_id
        : null);
    const text = await runAgentCollect(conversationId, prompt, {
      systemPrefix: systemPrefix
        ? `${systemPrefix}\n\nYou are executing a single node in a task graph. Goal: ${ctx.graph.root_goal}. Your output is captured verbatim — do not include conversational preamble.`
        : `You are executing a single node in a task graph. Goal: ${ctx.graph.root_goal}. Your output is captured verbatim — do not include conversational preamble.`,
      allowedTools: node.agent_spec.tools.length > 0 ? node.agent_spec.tools : undefined,
      fromGraph: true,
      modelPreference: node.agent_spec.model_preference,
      codingSessionId,
    });

    const wallSeconds = (Date.now() - t0) / 1000;
    // The engine doesn't yet expose per-call token counts; estimate from
    // output text. Upstream callers can use this for budget enforcement.
    const tokens = approxTokens(text);

    // If the contract specifies output_schema, attempt JSON parse for the
    // structured output field; otherwise the output is the raw text.
    let output: unknown = text;
    if (node.contract.output_schema) {
      // Extract the largest JSON block from the response — agents often
      // wrap structured output in prose.
      const match = text.match(/[\{\[][\s\S]*[\}\]]/);
      if (match) {
        try { output = JSON.parse(match[0]); } catch { /* leave as text — caller decides */ }
      }
    }

    return {
      ok: true,
      output,
      output_text: text,
      cost: { tokens, wall_seconds: wallSeconds, usd: 0 },
    };
  } catch (e) {
    const wallSeconds = (Date.now() - t0) / 1000;
    return {
      ok: false,
      output: null,
      cost: { tokens: 0, wall_seconds: wallSeconds, usd: 0 },
      error: (e as Error).message || String(e),
    };
  }
};
