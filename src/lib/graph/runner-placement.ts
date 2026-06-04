/**
 * Placement runner — per-node dispatch across local + paired peers.
 *
 * The executor calls this with a TaskNode; we:
 *   1. Pull fresh capability snapshots (local + cached peer heartbeats).
 *   2. Call `decidePlacement` to pick a target.
 *   3. Update the node's `executing_node_id` in the DB so the
 *      `/orchestration` page + trace SSE see the real placement (not just
 *      the originator).
 *   4. Invoke the appropriate leaf runner (defaultRunner for local,
 *      createPeerRunner for a peer).
 *
 * Composes cleanly with the V6.3 executor — no executor changes needed.
 */

import { defaultRunner } from "./runner-default";
import { createPeerRunner } from "./runner-peer";
import { decidePlacement, type PeerCandidate, type PlacementDecision } from "./placement";
import { snapshotCapability } from "../fleet/capabilities";
import { listPeers } from "../db/fleet";
import { setNodeStatus } from "../db/task-graphs";
import type { Capability } from "../fleet/capabilities";
import type { NodeRunner, NodeRunResult, RunnerContext, TaskNode } from "./types";

export type PlacementRunnerOptions = {
  /** Override the local capability snapshot — useful in tests. */
  localCapabilityOverride?: Capability;
  /** Override how peer candidates are gathered — useful in tests. */
  peerCandidatesOverride?: PeerCandidate[];
  /** Called for every placement decision so tests can assert on it. */
  onDecision?: (node: TaskNode, decision: PlacementDecision) => void;
};

function peerCandidatesFromDb(): PeerCandidate[] {
  return listPeers().map((p) => {
    let caps: Partial<Capability> = {};
    try { caps = JSON.parse(p.capabilities_json || "{}") as Partial<Capability>; } catch { /* keep empty */ }
    return {
      node_id: p.peer_node_id,
      capabilities: caps,
      last_seen_at: p.last_seen_at,
    };
  });
}

export function createPlacementRunner(opts: PlacementRunnerOptions = {}): NodeRunner {
  return async (node: TaskNode, ctx: RunnerContext): Promise<NodeRunResult> => {
    const localCaps = opts.localCapabilityOverride ?? (await snapshotCapability());
    const peers = opts.peerCandidatesOverride ?? peerCandidatesFromDb();
    const decision = decidePlacement(node.placement, localCaps, peers);
    if (opts.onDecision) opts.onDecision(node, decision);

    // Record where the work is actually running. The executor pre-set
    // executing_node_id to the originating node at schedule time; we now
    // overwrite with the actual chosen target so the orchestration page +
    // trace SSE reflect reality.
    const actualExecutor =
      decision.target.kind === "local" ? localCaps.node_id : decision.target.peer_node_id;
    setNodeStatus(node.node_id, "running", { executing_node_id: actualExecutor });

    const leaf =
      decision.target.kind === "local"
        ? defaultRunner
        : createPeerRunner(decision.target.peer_node_id);

    return leaf(node, ctx);
  };
}
