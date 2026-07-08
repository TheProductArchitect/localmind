/**
 * Refute pass — verification by adversarial check.
 *
 * For any node tagged `requires_verification: true`, after the node produces
 * its output the executor spawns a sibling that tries to REFUTE the output
 * against the contract. The refuter runs with reduced tools and parses a
 * structured JSON verdict from the model response.
 */

import type {
  NodeRunResult,
  NodeRunner,
  RunnerContext,
  TaskNode,
  Contract,
} from "./types";
import { ZERO_COST } from "./types";

export type RefuteVerdict = {
  refuted: boolean;
  reason: string;
  cost: typeof ZERO_COST;
};

/**
 * Build the refute prompt for a node. Pure — takes the node + its produced
 * output and returns the user message the refuter agent should respond to.
 *
 * Format keeps it succinct: the refuter doesn't need the parent context, just
 * the contract and the artefact. Forcing a structured JSON response lets the
 * executor parse the verdict deterministically.
 */
export function buildRefutePrompt(node: TaskNode, output: unknown): string {
  const contract = node.contract;
  const success = contract.success_predicate || "(no explicit predicate; check the output is well-formed and addresses the goal)";
  const outputStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return [
    `You are an adversarial reviewer. Try to refute the proposed output against the contract.`,
    ``,
    `# Contract`,
    `Success predicate: ${success}`,
    contract.output_schema ? `Output schema: ${JSON.stringify(contract.output_schema)}` : "",
    ``,
    `# Proposed output`,
    "```",
    outputStr.slice(0, 8000),
    "```",
    ``,
    `Default to refuted=true if you have any doubt. Reply with a single JSON object on its own line:`,
    `{ "refuted": <bool>, "reason": "<one-sentence reason, required when refuted is true>" }`,
  ].filter(Boolean).join("\n");
}

/**
 * Parse a refute response. Tolerates leading prose by extracting the last
 * JSON object on its own line.
 */
export function parseRefuteResponse(text: string): { refuted: boolean; reason: string } {
  // Find the last JSON-ish block.
  const matches = text.match(/\{[\s\S]*"refuted"[\s\S]*\}/g);
  const block = matches && matches.length > 0 ? matches[matches.length - 1] : null;
  if (!block) {
    // No structured verdict — fall back to safe-by-default refusal.
    return { refuted: true, reason: "Refuter did not produce a verdict; rejecting to be safe." };
  }
  try {
    const parsed = JSON.parse(block) as { refuted?: unknown; reason?: unknown };
    const refuted = parsed.refuted === true;
    const reason = typeof parsed.reason === "string" ? parsed.reason : refuted ? "refuted without stated reason" : "";
    return { refuted, reason };
  } catch {
    return { refuted: true, reason: "Refute verdict was not valid JSON; rejecting to be safe." };
  }
}

/**
 * Run the refute pass against an output using the executor's pluggable
 * runner. The verifier is constructed as a sibling task node so its work is
 * audited and budgeted alongside everything else.
 */
export async function runRefute(
  node: TaskNode,
  produced: unknown,
  runner: NodeRunner,
  ctx: RunnerContext
): Promise<RefuteVerdict> {
  // Build a sibling node spec specifically for the refuter. It mirrors the
  // original persona but the prompt template is the refute prompt, and tools
  // are reduced to read-only set (web_search, knowledge — no write tools).
  const refuteNode: TaskNode = {
    ...node,
    node_id: `${node.node_id}-refute`,
    parent_ids: [node.node_id],
    depends_on: [node.node_id],
    agent_spec: {
      ...node.agent_spec,
      tools: node.agent_spec.tools.filter((t) =>
        ["web_search", "knowledge", "memory", "datastore"].includes(t)
      ),
      prompt_template: buildRefutePrompt(node, produced),
      requires_verification: false,                  // never recurse
      retry_policy: "poisonable",
      max_iterations: 2,
    },
    input: { proposed_output: produced, contract: node.contract as Contract },
    status: "running",
    output: null,
    output_hash: null,
    cache_hit_of_node_id: null,
  };

  const r = await runner(refuteNode, ctx);
  if (!r.ok) {
    return {
      refuted: true,
      reason: `Refuter failed to run: ${r.error ?? "unknown error"}`,
      cost: { tokens: r.cost.tokens, wall_seconds: r.cost.wall_seconds, usd: r.cost.usd },
    };
  }

  const text = r.output_text ?? (typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? ""));
  const verdict = parseRefuteResponse(text);
  return { ...verdict, cost: r.cost };
}
