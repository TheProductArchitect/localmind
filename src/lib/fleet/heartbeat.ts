/**
 * Heartbeat loop. Every 30s, pushes this node's capability snapshot to each
 * paired peer that has `policy.advertise_capabilities = true`. Failures are
 * logged but never retried mid-tick — the next tick is the retry.
 *
 * Capability snapshots include `primary_addr` (see `snapshotCapability`).
 * Peers that receive the envelope call `updatePeerPrimaryAddr` in
 * `server.ts` so DHCP renumbers refresh `fleet_peers.primary_addr` without
 * re-pairing.
 *
 * The 30s cadence was set in §5 of the V6 plan. Tunable via the
 * `LOCALMIND_HEARTBEAT_INTERVAL_MS` env var for tests; never below 5s.
 */

import { listPeers, parsePeerPolicy } from "../db/fleet";
import { snapshotCapability } from "./capabilities";
import { sendToPeer } from "./peer-client";

const DEFAULT_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.LOCALMIND_HEARTBEAT_INTERVAL_MS) || 30_000
);

// Singleton across Next dev module contexts — same pattern as the fleet server.
type GlobalHeartbeat = {
  timer: ReturnType<typeof setInterval> | null;
  lastError: { peer: string; reason: string; at: number } | null;
  lastSuccess: { peer: string; at: number } | null;
  tickCount: number;
};
const GLOBAL_KEY = Symbol.for("localmind.fleet.heartbeat");
const slot = globalThis as unknown as Record<symbol, GlobalHeartbeat>;
if (!slot[GLOBAL_KEY]) {
  slot[GLOBAL_KEY] = { timer: null, lastError: null, lastSuccess: null, tickCount: 0 };
}
const hbState: GlobalHeartbeat = slot[GLOBAL_KEY];

export async function heartbeatOnce(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  failures: Array<{ peer: string; reason: string }>;
}> {
  hbState.tickCount += 1;
  const peers = listPeers().filter((p) => parsePeerPolicy(p).advertise_capabilities);
  if (peers.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, failures: [] };
  }

  const snapshot = await snapshotCapability();
  const failures: Array<{ peer: string; reason: string }> = [];
  let succeeded = 0;

  // Fire all in parallel — capability sends are independent.
  await Promise.all(
    peers.map(async (peer) => {
      const r = await sendToPeer(peer.peer_node_id, "capabilities", snapshot, { timeoutMs: 5_000 });
      if (r.ok) {
        succeeded += 1;
        hbState.lastSuccess = { peer: peer.peer_node_id, at: Date.now() };
      } else {
        const reason = `[${r.status}] ${r.reason}`;
        failures.push({ peer: peer.peer_node_id, reason });
        hbState.lastError = { peer: peer.peer_node_id, reason, at: Date.now() };
      }
    })
  );

  return { attempted: peers.length, succeeded, failed: failures.length, failures };
}

export function startHeartbeat(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (hbState.timer) return;
  hbState.timer = setInterval(() => {
    heartbeatOnce().catch((e) => {
      hbState.lastError = { peer: "*", reason: (e as Error).message, at: Date.now() };
    });
  }, intervalMs);
  // Don't keep the event loop alive if the rest of the app is idle (e.g.
  // during tests that finish quickly). The fleet listener is what keeps the
  // server up; the heartbeat is auxiliary.
  if (hbState.timer.unref) hbState.timer.unref();
}

export function stopHeartbeat(): void {
  if (hbState.timer) {
    clearInterval(hbState.timer);
    hbState.timer = null;
  }
}

export function heartbeatStatus(): {
  running: boolean;
  tick_count: number;
  last_success: GlobalHeartbeat["lastSuccess"];
  last_error: GlobalHeartbeat["lastError"];
  interval_ms: number;
} {
  return {
    running: hbState.timer !== null,
    tick_count: hbState.tickCount,
    last_success: hbState.lastSuccess,
    last_error: hbState.lastError,
    interval_ms: DEFAULT_INTERVAL_MS,
  };
}
