/**
 * Fleet DB helpers — paired peers, cross-node audit links, knowledge share
 * policy, and the canonical accessors for the single-row identity / clock
 * tables (those live in src/lib/fleet/identity.ts and clock.ts but their
 * relational reads happen here when other modules just want the data).
 *
 * Decision recap (locked in the V6 plan):
 *   - Per-node Ed25519 identity, fingerprint = node_id.
 *   - Single user-primary node by default; "authorize from peer" tokens are a
 *     V6.4 addition.
 *   - Originator owns canonical graph state; peer DB entries here record only
 *     execution receipts (the cross-references via fleet_audit_links).
 */

import { getConfigDb } from ".";

export type FleetPeer = {
  peer_node_id: string;
  pubkey_pem: string;
  label: string | null;
  primary_addr: string | null;
  paired_at: number;
  last_seen_at: number | null;
  capabilities_json: string;
  policy_json: string;
  trusted: number;
};

export type FleetAuditLink = {
  local_audit_id: number;
  peer_node_id: string;
  peer_audit_id: number;
  signature: string;
  direction: "outbound" | "inbound";
  lamport: number;
  created_at: number;
};

export type FleetPeerPolicy = {
  // Same-user-multi-machine convenience: lets the originator auto-approve
  // their own actions on this peer instead of prompting for PIN every time.
  // Off by default; enable per peer.
  allow_self_actions: boolean;
  // Tools the peer is explicitly allowed to run on our behalf. Empty array =
  // all tools subject to the local permission profile (which is always the
  // final gate).
  allowed_tools: string[];
  // Whether to share capability heartbeats with this peer at all. Lets you
  // pair a peer for one-off knowledge queries without inviting it into the
  // task-graph placement pool.
  advertise_capabilities: boolean;
  // Whether this peer is allowed to drive a CHAT session on us (the user is
  // sitting at the peer's UI but the model lives here). Default OFF — a peer
  // must be explicitly granted "you may run my chat for me" before we'll
  // accept chat-relay envelopes from it. This is a separate flag from
  // allow_self_actions because chat relay implies persistent conversation
  // state, not just one-shot delegations.
  accept_chat_relay: boolean;
  // Whether this peer may drive coding/git/worktree ops on our disk (workspace host).
  // Default OFF — grant explicitly per peer.
  accept_workspace_relay: boolean;
  // Whether this peer (running the LLM/agent elsewhere, e.g. a DGX hub) may run
  // allowlisted personal-assistant tools (filesystem, calendar, email,
  // reminders, contacts, browser, mac automation) back on OUR device. Lets the
  // model think on the hub while actions happen on the user's own PC.
  // Default OFF — grant explicitly per peer. Never includes shell.
  accept_tool_relay: boolean;
  // Maximum inbound chat-relay messages per minute from this peer.
  // Defends against a compromised peer flooding our local model.
  chat_relay_rate_per_min: number;
  // Whether to sync conversation threads (messages + titles) with this peer
  // so every paired device sees the same chat history. Attribution
  // (origin_node_id / origin_label) is preserved. Default ON for personal
  // LAN mesh; turn off for a peer that should only share compute/knowledge.
  sync_conversations: boolean;
};

export const DEFAULT_PEER_POLICY: FleetPeerPolicy = {
  allow_self_actions: false,
  allowed_tools: [],
  advertise_capabilities: true,
  accept_chat_relay: false,
  accept_workspace_relay: false,
  accept_tool_relay: false,
  chat_relay_rate_per_min: 30,
  sync_conversations: true,
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

// -------------------------------------------------------------------------
// Peer management
// -------------------------------------------------------------------------

export function listPeers(): FleetPeer[] {
  return getConfigDb()
    .prepare("SELECT * FROM fleet_peers ORDER BY paired_at DESC")
    .all() as FleetPeer[];
}

export function getPeer(peerNodeId: string): FleetPeer | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM fleet_peers WHERE peer_node_id=?")
      .get(peerNodeId) as FleetPeer | undefined) || null
  );
}

export function pairPeer(args: {
  peer_node_id: string;
  pubkey_pem: string;
  label?: string | null;
  primary_addr?: string | null;
  policy?: Partial<FleetPeerPolicy>;
}): FleetPeer {
  const policy = { ...DEFAULT_PEER_POLICY, ...(args.policy ?? {}) };
  getConfigDb()
    .prepare(
      `INSERT INTO fleet_peers
        (peer_node_id, pubkey_pem, label, primary_addr, paired_at, capabilities_json, policy_json, trusted)
       VALUES (?, ?, ?, ?, ?, '{}', ?, 1)
       ON CONFLICT(peer_node_id) DO UPDATE SET
         pubkey_pem = excluded.pubkey_pem,
         label      = excluded.label,
         primary_addr = excluded.primary_addr,
         policy_json = excluded.policy_json,
         trusted    = 1`
    )
    .run(
      args.peer_node_id,
      args.pubkey_pem,
      args.label ?? null,
      args.primary_addr ?? null,
      readNow(),
      JSON.stringify(policy)
    );
  return getPeer(args.peer_node_id)!;
}

export function unpairPeer(peerNodeId: string): boolean {
  const r = getConfigDb().prepare("DELETE FROM fleet_peers WHERE peer_node_id=?").run(peerNodeId);
  return r.changes > 0;
}

export function updatePeerLabel(peerNodeId: string, label: string | null): void {
  getConfigDb().prepare("UPDATE fleet_peers SET label=? WHERE peer_node_id=?").run(label, peerNodeId);
}

export function updatePeerPolicy(peerNodeId: string, patch: Partial<FleetPeerPolicy>): FleetPeer | null {
  const peer = getPeer(peerNodeId);
  if (!peer) return null;
  let current: FleetPeerPolicy;
  try {
    current = { ...DEFAULT_PEER_POLICY, ...(JSON.parse(peer.policy_json) as Partial<FleetPeerPolicy>) };
  } catch {
    current = { ...DEFAULT_PEER_POLICY };
  }
  const merged = { ...current, ...patch };
  getConfigDb()
    .prepare("UPDATE fleet_peers SET policy_json=? WHERE peer_node_id=?")
    .run(JSON.stringify(merged), peerNodeId);
  return getPeer(peerNodeId);
}

export function recordCapabilities(peerNodeId: string, capabilities: Record<string, unknown>): void {
  getConfigDb()
    .prepare("UPDATE fleet_peers SET capabilities_json=?, last_seen_at=? WHERE peer_node_id=?")
    .run(JSON.stringify(capabilities), readNow(), peerNodeId);
}

export function markPeerSeen(peerNodeId: string): void {
  getConfigDb().prepare("UPDATE fleet_peers SET last_seen_at=? WHERE peer_node_id=?").run(readNow(), peerNodeId);
}

/**
 * Refresh a peer's reachable address from its heartbeat so a DHCP renumber or
 * NIC change doesn't brick the mesh until re-pairing. No-op when unchanged or
 * when the advertised value is empty/loopback.
 */
export function updatePeerPrimaryAddr(peerNodeId: string, primaryAddr: string | null | undefined): void {
  if (!primaryAddr || primaryAddr.startsWith("127.") || primaryAddr.startsWith("localhost")) return;
  const peer = getPeer(peerNodeId);
  if (!peer || peer.primary_addr === primaryAddr) return;
  getConfigDb()
    .prepare("UPDATE fleet_peers SET primary_addr=? WHERE peer_node_id=?")
    .run(primaryAddr, peerNodeId);
}

export function parsePeerPolicy(peer: FleetPeer): FleetPeerPolicy {
  try {
    return { ...DEFAULT_PEER_POLICY, ...(JSON.parse(peer.policy_json) as Partial<FleetPeerPolicy>) };
  } catch {
    return { ...DEFAULT_PEER_POLICY };
  }
}

// -------------------------------------------------------------------------
// Audit link bookkeeping
// -------------------------------------------------------------------------

export function recordAuditLink(args: {
  local_audit_id: number;
  peer_node_id: string;
  peer_audit_id: number;
  signature: string;
  direction: "outbound" | "inbound";
  lamport: number;
}): void {
  getConfigDb()
    .prepare(
      `INSERT INTO fleet_audit_links
        (local_audit_id, peer_node_id, peer_audit_id, signature, direction, lamport, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_audit_id, peer_node_id, peer_audit_id, direction) DO NOTHING`
    )
    .run(
      args.local_audit_id,
      args.peer_node_id,
      args.peer_audit_id,
      args.signature,
      args.direction,
      args.lamport,
      readNow()
    );
}

export function listAuditLinksFor(localAuditId: number): FleetAuditLink[] {
  return getConfigDb()
    .prepare("SELECT * FROM fleet_audit_links WHERE local_audit_id=? ORDER BY created_at")
    .all(localAuditId) as FleetAuditLink[];
}

export function findAuditLinkByPeerRef(
  peerNodeId: string,
  peerAuditId: number
): FleetAuditLink | null {
  return (
    (getConfigDb()
      .prepare(
        "SELECT * FROM fleet_audit_links WHERE peer_node_id=? AND peer_audit_id=? LIMIT 1"
      )
      .get(peerNodeId, peerAuditId) as FleetAuditLink | undefined) || null
  );
}

// -------------------------------------------------------------------------
// Knowledge share policy
// -------------------------------------------------------------------------

export type KnowledgeSharePolicy = "private" | "fleet-readable" | "fleet-queryable";

export type KnowledgePolicyRow = {
  document_id: string;
  policy: KnowledgeSharePolicy;
  granted_peers_json: string;
  updated_at: number;
};

export function getKnowledgePolicy(documentId: string): KnowledgePolicyRow | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM knowledge_share_policy WHERE document_id=?")
      .get(documentId) as KnowledgePolicyRow | undefined) || null
  );
}

export function setKnowledgePolicy(args: {
  document_id: string;
  policy: KnowledgeSharePolicy;
  granted_peers?: string[];
}): KnowledgePolicyRow {
  getConfigDb()
    .prepare(
      `INSERT INTO knowledge_share_policy (document_id, policy, granted_peers_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         policy = excluded.policy,
         granted_peers_json = excluded.granted_peers_json,
         updated_at = excluded.updated_at`
    )
    .run(args.document_id, args.policy, JSON.stringify(args.granted_peers ?? []), readNow());
  return getKnowledgePolicy(args.document_id)!;
}

/**
 * Returns true if `peerNodeId` is allowed to access `documentId` at the given
 * minimum level. `fleet-readable` allows fetch-by-id; `fleet-queryable` allows
 * search. Both honour the `granted_peers` allow-list when non-empty (empty =
 * any paired peer).
 */
export function peerCanAccessDocument(
  peerNodeId: string,
  documentId: string,
  minimumLevel: KnowledgeSharePolicy
): boolean {
  const row = getKnowledgePolicy(documentId);
  if (!row) return false;
  if (row.policy === "private") return false;
  // 'fleet-readable' is strictly stronger than 'fleet-queryable' for direct
  // reads — a doc set to fleet-queryable cannot be fetched in full.
  if (minimumLevel === "fleet-readable" && row.policy !== "fleet-readable") return false;
  let granted: string[] = [];
  try { granted = JSON.parse(row.granted_peers_json) as string[]; } catch { /* leave empty */ }
  return granted.length === 0 || granted.includes(peerNodeId);
}
