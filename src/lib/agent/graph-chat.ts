import { buildSingleNode } from "../graph/build";
import { executeGraph } from "../graph/executor";
import { defaultRunner } from "../graph/runner-default";
import { listNodes } from "../db/task-graphs";

type CollectOpts = {
  systemPrefix?: string;
  processMetadata?: Record<string, unknown>;
  processDisplayName?: string;
  allowedTools?: readonly string[];
  modelPreference?: string | null;
};

/**
 * Execute a chat message through the V6 task-graph executor (single-node graph).
 * Used as the default path for runAgentCollect — the graph runner calls back
 * into runAgentCollect with fromGraph=true to avoid recursion.
 */
export async function runCollectViaGraph(
  conversationId: string,
  message: string,
  opts?: CollectOpts
): Promise<string> {
  const graph = buildSingleNode({
    root_goal: message.slice(0, 200),
    agent_spec: {
      persona_id:
        (opts?.processMetadata as { persona_id?: string } | undefined)?.persona_id ?? "persona-general",
      tools: opts?.allowedTools ? [...opts.allowedTools] : [],
      model_preference: opts?.modelPreference ?? undefined,
      prompt_template: message,
      max_iterations: 12,
    },
    input: { message, system_prefix: opts?.systemPrefix ?? "" },
  });

  const outcome = await executeGraph(graph.graph_id, {
    runner: defaultRunner,
    skip_refute: true,
  });

  if (outcome.final_status === "completed") {
    const nodes = listNodes(graph.graph_id);
    const done = nodes.filter((n) => n.status === "done" || n.status === "cached");
    const last = done[done.length - 1];
    if (last?.output != null) {
      return typeof last.output === "string" ? last.output : JSON.stringify(last.output);
    }
  }

  return `(graph ${outcome.final_status})`;
}
