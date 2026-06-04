/**
 * Peer node runner — executes a single TaskNode by delegating it to a paired
 * peer via the V6.4 federation primitives.
 *
 * Implements the same `NodeRunner` shape as the local default runner so the
 * executor doesn't need to know who's actually doing the work. The
 * `createPeerRunner` factory binds a runner to a specific peer; the
 * placement runner (see runner-placement.ts) constructs these per-call
 * after deciding where each node should land.
 *
 * Errors are returned as `{ ok: false, error }` rather than thrown — the
 * executor's retry policy then decides whether to retry locally, retry on
 * another peer, or surface the failure (V6 plan §8).
 */

import { delegateToPeer } from "../fleet/delegation";
import type { NodeRunner, NodeRunResult, RunnerContext, TaskNode } from "./types";

export function createPeerRunner(peerNodeId: string): NodeRunner {
  return async (node: TaskNode, ctx: RunnerContext): Promise<NodeRunResult> => {
    const t0 = Date.now();
    const r = await delegateToPeer({
      peer_node_id: peerNodeId,
      node_id: node.node_id,
      agent_spec: node.agent_spec,
      input: node.input,
      contract: node.contract,
      parent_outputs: ctx.parent_outputs,
      root_goal: ctx.graph.root_goal,
      conversation_id: ctx.conversation_id ?? null,
      // Per-node budget caps how long we wait on the peer. Add a small
      // overhead so the peer's own timeout fires first and surfaces a clean
      // error envelope rather than us giving up first.
      timeout_ms: Math.max(10_000, (node.contract.cost_budget.wall_seconds ?? 60) * 1000 + 5_000),
    });

    if (!r.ok) {
      return {
        ok: false,
        output: null,
        cost: { tokens: 0, wall_seconds: (Date.now() - t0) / 1000, usd: 0 },
        error: r.reason,
      };
    }
    // Peer-reported cost is authoritative — they actually measured it. We
    // don't add the network round-trip to wall_seconds since the contract
    // budget is for the work itself.
    return {
      ok: true,
      output: r.output,
      output_text: r.output_text,
      cost: r.cost,
    };
  };
}
