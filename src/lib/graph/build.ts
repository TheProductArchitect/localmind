/**
 * Graph builders. Three shapes worth a first-class helper:
 *
 *   - singleNode  : goal → one node (chat-equivalent)
 *   - linear      : goal → n nodes in series, each consumes prior output
 *   - fanOutJoin  : goal → splitter → workers → join (the most common pattern
 *                   in V6 — fan-out research, multi-source synthesis, etc.)
 *
 * Each builder writes the graph + its nodes in a single transaction so a
 * partially-materialised graph never exists in the DB.
 */

import { getConfigDb } from "../db";
import { addNode, createGraph } from "../db/task-graphs";
import { getNodeIdentity } from "../fleet/identity";
import type { AgentSpec, Contract, CostBudget, TaskGraph } from "./types";

const DEFAULT_NODE_BUDGET: Contract["cost_budget"] = { tokens: 8000, wall_seconds: 120 };
const DEFAULT_GRAPH_BUDGET: CostBudget = { tokens: 40000, wall_seconds: 600 };

export type BuildOpts = {
  owner_user_id?: string | null;
  cost_budget?: CostBudget;
  parent_audit_id?: number | null;
};

function originatingNode(): string {
  try { return getNodeIdentity().node_id; } catch { return "unknown"; }
}

function withTx<T>(fn: () => T): T {
  return getConfigDb().transaction(fn)();
}

/** Single-node graph — the V6 compile target for one-shot chat. */
export function buildSingleNode(args: {
  root_goal: string;
  agent_spec: AgentSpec;
  input: Record<string, unknown>;
  contract?: Contract;
  opts?: BuildOpts;
}): TaskGraph {
  return withTx(() => {
    const graph = createGraph({
      owner_user_id: args.opts?.owner_user_id ?? null,
      originating_node_id: originatingNode(),
      root_goal: args.root_goal,
      cost_budget: args.opts?.cost_budget ?? DEFAULT_GRAPH_BUDGET,
      parent_audit_id: args.opts?.parent_audit_id ?? null,
    });
    addNode({
      graph_id: graph.graph_id,
      agent_spec: args.agent_spec,
      input: args.input,
      contract: args.contract ?? { cost_budget: DEFAULT_NODE_BUDGET },
    });
    return graph;
  });
}

/** Linear chain — each node depends on the previous. */
export function buildLinear(args: {
  root_goal: string;
  nodes: Array<{
    agent_spec: AgentSpec;
    input?: Record<string, unknown>;
    contract?: Contract;
  }>;
  opts?: BuildOpts;
}): TaskGraph {
  return withTx(() => {
    const graph = createGraph({
      owner_user_id: args.opts?.owner_user_id ?? null,
      originating_node_id: originatingNode(),
      root_goal: args.root_goal,
      cost_budget: args.opts?.cost_budget ?? DEFAULT_GRAPH_BUDGET,
      parent_audit_id: args.opts?.parent_audit_id ?? null,
    });
    let prev: string | null = null;
    for (const step of args.nodes) {
      const n = addNode({
        graph_id: graph.graph_id,
        parent_ids: prev ? [prev] : [],
        depends_on: prev ? [prev] : [],
        agent_spec: step.agent_spec,
        input: step.input ?? {},
        contract: step.contract ?? { cost_budget: DEFAULT_NODE_BUDGET },
      });
      prev = n.node_id;
    }
    return graph;
  });
}

/**
 * Fan-out / join — one splitter node, N workers fed by the splitter, one join
 * node fed by all workers. The most common research pattern.
 */
export function buildFanOutJoin(args: {
  root_goal: string;
  splitter: { agent_spec: AgentSpec; input?: Record<string, unknown>; contract?: Contract };
  workers: Array<{ agent_spec: AgentSpec; input?: Record<string, unknown>; contract?: Contract }>;
  join: { agent_spec: AgentSpec; input?: Record<string, unknown>; contract?: Contract };
  opts?: BuildOpts;
}): TaskGraph {
  return withTx(() => {
    const graph = createGraph({
      owner_user_id: args.opts?.owner_user_id ?? null,
      originating_node_id: originatingNode(),
      root_goal: args.root_goal,
      cost_budget: args.opts?.cost_budget ?? DEFAULT_GRAPH_BUDGET,
      parent_audit_id: args.opts?.parent_audit_id ?? null,
    });

    const splitter = addNode({
      graph_id: graph.graph_id,
      agent_spec: args.splitter.agent_spec,
      input: args.splitter.input ?? {},
      contract: args.splitter.contract ?? { cost_budget: DEFAULT_NODE_BUDGET },
    });

    const workerIds: string[] = [];
    for (const w of args.workers) {
      const n = addNode({
        graph_id: graph.graph_id,
        parent_ids: [splitter.node_id],
        depends_on: [splitter.node_id],
        agent_spec: w.agent_spec,
        input: w.input ?? {},
        contract: w.contract ?? { cost_budget: DEFAULT_NODE_BUDGET },
      });
      workerIds.push(n.node_id);
    }

    addNode({
      graph_id: graph.graph_id,
      parent_ids: workerIds,
      depends_on: workerIds,
      agent_spec: args.join.agent_spec,
      input: args.join.input ?? {},
      contract: args.join.contract ?? { cost_budget: DEFAULT_NODE_BUDGET },
    });

    return graph;
  });
}
