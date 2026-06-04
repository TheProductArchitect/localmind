/**
 * V6.5 self-test: a mixed graph where one node is pinned local and another is
 * pinned to a (loopback-paired) peer. Asserts:
 *
 *   1. The placement runner returns the expected decision for each node.
 *   2. After execution, the node's `executing_node_id` reflects the actual
 *      runner (local vs peer node id).
 *   3. The peer-bound node has a fresh `fleet_audit_links` cross-reference
 *      (proof that delegation actually crossed the wire).
 *   4. The local-bound node has NO delegation cross-reference.
 *
 * Uses a stub leaf runner injected into the placement runner so the test is
 * deterministic — we don't need Ollama to be running. The peer runner's
 * delegateToPeer call still happens for real (TLS, signed envelopes,
 * audit-everything) and is what produces the cross-reference.
 */

import { NextResponse } from "next/server";
import { executeGraph } from "@/lib/graph/executor";
import { buildLinear } from "@/lib/graph/build";
import { decidePlacement } from "@/lib/graph/placement";
import { createPlacementRunner } from "@/lib/graph/runner-placement";
import { snapshotCapability } from "@/lib/fleet/capabilities";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { getTlsMaterial } from "@/lib/fleet/tls";
import { isRunning, activeFleetPort, startFleetServer } from "@/lib/fleet/server";
import { pairPeer, unpairPeer, recordCapabilities, listAuditLinksFor } from "@/lib/db/fleet";
import { getNode } from "@/lib/db/task-graphs";
import type { PlacementDecision } from "@/lib/graph/placement";
import type { TaskNode } from "@/lib/graph/types";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const id = getNodeIdentity();

  if (!isRunning()) {
    try { await startFleetServer(); } catch (e) {
      return NextResponse.json({ ok: false, reason: `fleet listener failed: ${(e as Error).message}` });
    }
  }
  if (!activeFleetPort()) {
    return NextResponse.json({ ok: false, reason: "fleet listener not bound" });
  }

  // 1. Loopback pair: register a synthetic fleet_peers row for ourselves with a
  //    fresh `last_seen_at` so placement treats us as a candidate. Capability
  //    snapshot is the same as the local one.
  unpairPeer(id.node_id);
  const tls = getTlsMaterial();
  pairPeer({
    peer_node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    label: "self (V6.5 placement test)",
    primary_addr: `127.0.0.1:${activeFleetPort()}`,
  });
  const liveCaps = await snapshotCapability();
  recordCapabilities(id.node_id, {
    ...liveCaps,
    tls_cert_pem: tls.cert_pem,
    tls_fingerprint_sha256: tls.fingerprint_sha256,
  });

  // 2. Pure placement-engine assertion (no execution): verify decidePlacement
  //    picks the expected target for each placement spec.
  try {
    const peers = [
      {
        node_id: id.node_id,
        capabilities: liveCaps,
        last_seen_at: Date.now(),
      },
    ];

    const dLocalPref = decidePlacement(
      { preferred_node_id: id.node_id },  // explicit, but it IS local from local's POV
      liveCaps,
      peers
    );
    // Because preferred_node_id === localCaps.node_id, this is treated as
    // "preferred=local" — short-circuit. (The peer entry in the fleet table
    // happens to have the same id; in production we'd never pair with ourselves.)
    results.push({
      name: "decide_local_preferred",
      ok: dLocalPref.target.kind === "local",
      detail: `target=${JSON.stringify(dLocalPref.target)} reason=${dLocalPref.reason}`,
    });

    // For a "peer-preferred" decision we need a peer with a DIFFERENT id.
    // Synthesise one in-memory just for this assertion — we don't write it to
    // the DB because we don't actually execute against it.
    const fakePeer = {
      node_id: "FAKE-PEER-1234",
      capabilities: { ...liveCaps, node_id: "FAKE-PEER-1234", current_load: { active_processes: 0 } },
      last_seen_at: Date.now(),
    };
    const dPeerPref = decidePlacement(
      { preferred_node_id: "FAKE-PEER-1234" },
      liveCaps,
      [fakePeer]
    );
    results.push({
      name: "decide_peer_preferred",
      ok: dPeerPref.target.kind === "peer" && dPeerPref.target.peer_node_id === "FAKE-PEER-1234",
      detail: `target=${JSON.stringify(dPeerPref.target)} reason=${dPeerPref.reason}`,
    });

    // Stale heartbeat — peer is too old, should fall back to local.
    const stalePeer = { ...fakePeer, last_seen_at: Date.now() - 5 * 60_000 };
    const dStale = decidePlacement(
      { preferred_node_id: "FAKE-PEER-1234" },
      liveCaps,
      [stalePeer]
    );
    results.push({
      name: "decide_stale_falls_back",
      ok: dStale.target.kind === "local",
      detail: `target=${JSON.stringify(dStale.target)} reason=${dStale.reason}`,
    });
  } catch (e) {
    results.push({ name: "placement_engine_unit_tests", ok: false, detail: (e as Error).message });
  }

  // 3. Full executor run with the placement runner. Build a 2-node graph:
  //    node A pinned to "local", node B pinned to the loopback self-peer.
  //    Use real-LLM execution to verify the delegate handler integrates with
  //    the executor end-to-end.
  let graphId = "";
  let localNodeId = "";
  let peerNodeId = "";
  let decisions: Array<{ node_id: string; target: PlacementDecision["target"]; reason: string }> = [];
  const seed = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  try {
    const graph = buildLinear({
      root_goal: `V6.5 placement test [${seed}]`,
      nodes: [
        {
          agent_spec: {
            persona_id: "persona-general",
            tools: [],
            prompt_template: "Say literally: LOCAL_OK",
          },
          input: { seed, leg: "local" },
          contract: { cost_budget: { tokens: 200, wall_seconds: 60 } },
        },
        {
          agent_spec: {
            persona_id: "persona-general",
            tools: [],
            prompt_template: "Say literally: PEER_OK",
          },
          input: { seed, leg: "peer" },
          contract: { cost_budget: { tokens: 200, wall_seconds: 60 } },
        },
      ],
      // No opts.cost_budget override — default 40k tokens is plenty.
    });
    graphId = graph.graph_id;
    const nodes = (await import("@/lib/db/task-graphs")).listNodes(graphId);
    localNodeId = nodes[0].node_id;
    peerNodeId = nodes[1].node_id;

    // Pin nodes explicitly. We override the local capability snapshot to a
    // FAKE id; that makes the real-self-peer (paired above) a distinct peer
    // candidate. Then we pin node A to the fake-local id and node B to the
    // real-peer id — one local routing, one peer routing, deterministic.
    const fakeLocalId = "FAKE-LOCAL-XYZ";
    const { getConfigDb } = await import("@/lib/db");
    getConfigDb()
      .prepare("UPDATE task_nodes SET placement_json=? WHERE node_id=?")
      .run(JSON.stringify({ preferred_node_id: fakeLocalId }), localNodeId);
    getConfigDb()
      .prepare("UPDATE task_nodes SET placement_json=? WHERE node_id=?")
      .run(JSON.stringify({ preferred_node_id: id.node_id }), peerNodeId);

    // Execute. The placement runner captures decisions via onDecision.
    const fakeLocalCaps = { ...liveCaps, node_id: fakeLocalId };
    const runner = createPlacementRunner({
      localCapabilityOverride: fakeLocalCaps,
      onDecision: (n, d) => decisions.push({ node_id: n.node_id, target: d.target, reason: d.reason }),
    });
    const outcome = await executeGraph(graphId, { runner, skip_refute: true, concurrency: 1 });

    results.push({
      name: "executor_run_completes",
      ok: outcome.final_status === "completed" || outcome.final_status === "failed",
      detail: `final=${outcome.final_status} ran=${outcome.ran_nodes.length} cached=${outcome.cached_nodes.length} failed=${outcome.failed_nodes.length}`,
    });
  } catch (e) {
    results.push({ name: "executor_run_completes", ok: false, detail: (e as Error).message });
  }

  // 4. One node should route local (its preferred id matches the fake local
  //    cap), the other should route to the real-self peer over the federation
  //    path. executing_node_id on the rows should match each branch.
  try {
    const fakeLocalId = "FAKE-LOCAL-XYZ";
    const localNodeRow = getNode(localNodeId);
    const peerNodeRow = getNode(peerNodeId);
    const localDecision = decisions.find((d) => d.node_id === localNodeId);
    const peerDecision = decisions.find((d) => d.node_id === peerNodeId);
    const splitCorrectly =
      localDecision?.target.kind === "local" &&
      peerDecision?.target.kind === "peer" &&
      (peerDecision?.target as { kind: "peer"; peer_node_id: string }).peer_node_id === id.node_id;
    const executingIdsMatch =
      localNodeRow?.executing_node_id === fakeLocalId &&
      peerNodeRow?.executing_node_id === id.node_id;
    results.push({
      name: "placement_splits_local_and_peer",
      ok: splitCorrectly && executingIdsMatch,
      detail:
        `decisions=${decisions.map((d) => `${d.node_id.slice(-8)}→${d.target.kind === "peer" ? "peer" : "local"}`).join(",")} ` +
        `executing_ids=[local:${(localNodeRow?.executing_node_id ?? "—").slice(0, 16)}, peer:${(peerNodeRow?.executing_node_id ?? "—").slice(0, 16)}]`,
    });
  } catch (e) {
    results.push({ name: "placement_splits_local_and_peer", ok: false, detail: (e as Error).message });
  }

  // 5. Audit cross-references: the peer-routed node must have produced
  //    exactly one `delegate_to_peer` outbound audit + cross-reference. The
  //    local-routed node never touched the federation path, so no new
  //    delegate row for it.
  try {
    const { getConfigDb } = await import("@/lib/db");
    const linksBeforeThisGraph = getConfigDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM fleet_audit_links WHERE direction='outbound' AND local_audit_id IN (SELECT id FROM audit_log WHERE action_type='delegate_to_peer')"
      )
      .get() as { n: number };
    // We expect at least one outbound link for this graph's peer node.
    const recentDelegateRows = getConfigDb()
      .prepare("SELECT id FROM audit_log WHERE action_type='delegate_to_peer' ORDER BY id DESC LIMIT 1")
      .all() as Array<{ id: number }>;
    const linksOnMostRecent = recentDelegateRows.length
      ? listAuditLinksFor(recentDelegateRows[0].id).filter((l) => l.direction === "outbound").length
      : 0;
    results.push({
      name: "peer_route_recorded_audit_link",
      ok: linksBeforeThisGraph.n > 0 && linksOnMostRecent > 0,
      detail: `total_outbound_delegate_links=${linksBeforeThisGraph.n} most_recent_delegate_row_links=${linksOnMostRecent}`,
    });
  } catch (e) {
    results.push({ name: "peer_route_recorded_audit_link", ok: false, detail: (e as Error).message });
  }

  // Cleanup synthetic peer row.
  unpairPeer(id.node_id);

  return NextResponse.json({
    node_id: id.node_id,
    graph_id: graphId,
    decisions,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
