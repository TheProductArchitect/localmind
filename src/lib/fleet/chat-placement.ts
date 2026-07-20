/**
 * Chat placement — pick where a chat turn should run across the LAN mesh.
 *
 * Uses the same load-based placement engine as task graphs: prefer the
 * freshest peer with the lowest active_process count; tie-break to local
 * (avoids a network hop when load is equal).
 */

import { decidePlacement, type PeerCandidate } from "../graph/placement";
import { snapshotCapability, type Capability } from "./capabilities";
import { listPeers, parsePeerPolicy } from "../db/fleet";

export type ChatExecutor =
  | { kind: "local"; reason: string }
  | { kind: "peer"; peer_node_id: string; label: string; reason: string };

function parseCaps(json: string): Partial<Capability> {
  try {
    return JSON.parse(json || "{}") as Partial<Capability>;
  } catch {
    return {};
  }
}

/**
 * Decide where the next chat turn should execute.
 * Only peers that advertise capabilities (and are fresh) are candidates;
 * chat-relay still requires `accept_chat_relay` on the *executor* side —
 * we filter to peers we've marked as willing remote chat targets via
 * a soft signal: they advertise capabilities and are trusted. The hard
 * gate remains on the executor when the relay arrives.
 */
export async function pickChatExecutor(): Promise<ChatExecutor> {
  const localCaps = await snapshotCapability();
  const peers: PeerCandidate[] = listPeers()
    .filter((p) => p.trusted === 1 && parsePeerPolicy(p).advertise_capabilities)
    .map((p) => ({
      node_id: p.peer_node_id,
      capabilities: parseCaps(p.capabilities_json),
      last_seen_at: p.last_seen_at,
    }));

  const decision = decidePlacement({}, localCaps, peers);
  if (decision.target.kind === "local") {
    return { kind: "local", reason: decision.reason };
  }

  const peerId = decision.target.peer_node_id;
  const peer = listPeers().find((p) => p.peer_node_id === peerId);
  return {
    kind: "peer",
    peer_node_id: peerId,
    label: peer?.label || peerId.slice(0, 12),
    reason: decision.reason,
  };
}
