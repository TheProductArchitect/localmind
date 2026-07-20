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
 * Candidates: trusted peers that advertise capabilities AND advertise
 * `accepts_chat_relay` (they have granted inbound chat-relay to at least
 * one peer). The hard gate still runs on the executor when the relay arrives.
 */
export async function pickChatExecutor(): Promise<ChatExecutor> {
  const localCaps = await snapshotCapability();
  const peers: PeerCandidate[] = listPeers()
    .filter((p) => {
      if (p.trusted !== 1) return false;
      if (!parsePeerPolicy(p).advertise_capabilities) return false;
      const caps = parseCaps(p.capabilities_json);
      // Prefer peers that advertise relay willingness; if the field is
      // missing (older builds), still consider them — executor will refuse.
      if (caps.accepts_chat_relay === false) return false;
      return true;
    })
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
