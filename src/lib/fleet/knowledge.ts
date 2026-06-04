/**
 * Outbound knowledge-share client.
 *
 *   queryPeer(peer, query)         single-peer search
 *   fetchFromPeer(peer, doc_id)    single-peer full-content pull
 *   fanoutQuery(query)             ask all paired peers in parallel,
 *                                  merge + score results, 5s timeout
 *                                  (decision §14.5: synchronous with low timeout)
 *
 * Each query/fetch is also recorded on OUR audit log via the outbound
 * `external_query` / `external_fetch` action types so a user can see "I asked
 * X for Y at time Z." The receiver records the inbound counterparts
 * separately (handled by handlers/knowledge-query.ts and handlers/knowledge-fetch.ts).
 */

import { sendToPeer } from "./peer-client";
import { listPeers } from "../db/fleet";
import { logStart, logComplete, linkAuditToPeer } from "../agent/audit-logger";
import type {
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
} from "./handlers/knowledge-query";
import type {
  KnowledgeFetchRequest,
  KnowledgeFetchResponse,
} from "./handlers/knowledge-fetch";
import type { ShareableSnippet, ShareableContent } from "../db/knowledge-share";

const QUERY_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;

export type PeerQueryResult = {
  peer_node_id: string;
  peer_label: string | null;
  ok: boolean;
  results: ShareableSnippet[];
  reason?: string;
};

export type PeerFetchResult = {
  peer_node_id: string;
  ok: boolean;
  content?: ShareableContent;
  reason?: string;
};

/** Ask one paired peer to search their shareable knowledge. */
export async function queryPeer(
  peerNodeId: string,
  query: string,
  opts: { limit?: number; conversation_id?: string | null } = {}
): Promise<PeerQueryResult> {
  const peers = listPeers();
  const peer = peers.find((p) => p.peer_node_id === peerNodeId);
  if (!peer) {
    return { peer_node_id: peerNodeId, peer_label: null, ok: false, results: [], reason: "Unknown peer" };
  }

  const localAuditId = logStart({
    actionType: "external_query",
    toolName: "knowledge_share",
    input: { peer: peerNodeId, query: query.slice(0, 500), limit: opts.limit ?? 10 },
    conversationId: opts.conversation_id ?? null,
    approvedBy: "user",
  });

  const req: KnowledgeQueryRequest = { query, limit: opts.limit ?? 10 };
  const r = await sendToPeer<KnowledgeQueryRequest, KnowledgeQueryResponse>(
    peerNodeId,
    "knowledge-query",
    req,
    { timeoutMs: QUERY_TIMEOUT_MS }
  );
  if (!r.ok) {
    logComplete(localAuditId, "failed", `peer query failed: ${r.reason}`);
    return { peer_node_id: peerNodeId, peer_label: peer.label, ok: false, results: [], reason: r.reason };
  }
  const env = r.envelope;
  const body = env.payload;
  // The peer's handler audited the query on their side; we link our outbound
  // row to their inbound row by lamport. They don't return their audit row id
  // for query (it's a lightweight read), so we use the envelope's lamport as
  // the peer_audit_id surrogate — same convention as the handler's input.
  linkAuditToPeer(localAuditId, {
    peer_node_id: peerNodeId,
    peer_audit_id: env.lamport,
    signature: env.sig,
    lamport: env.lamport,
    direction: "outbound",
  });
  logComplete(
    localAuditId,
    body.ok ? "allowed" : "failed",
    body.ok ? `received ${body.results?.length ?? 0} snippet(s)` : (body.reason ?? "peer refused")
  );
  return {
    peer_node_id: peerNodeId,
    peer_label: peer.label,
    ok: !!body.ok,
    results: body.results ?? [],
    reason: body.reason,
  };
}

/** Pull full content of one document from a specific peer. */
export async function fetchFromPeer(
  peerNodeId: string,
  documentId: string,
  opts: { conversation_id?: string | null } = {}
): Promise<PeerFetchResult> {
  const peers = listPeers();
  const peer = peers.find((p) => p.peer_node_id === peerNodeId);
  if (!peer) {
    return { peer_node_id: peerNodeId, ok: false, reason: "Unknown peer" };
  }

  const localAuditId = logStart({
    actionType: "external_fetch",
    toolName: "knowledge_share",
    input: { peer: peerNodeId, document_id: documentId },
    conversationId: opts.conversation_id ?? null,
    approvedBy: "user",
  });

  const req: KnowledgeFetchRequest = { document_id: documentId };
  const r = await sendToPeer<KnowledgeFetchRequest, KnowledgeFetchResponse>(
    peerNodeId,
    "knowledge-fetch",
    req,
    { timeoutMs: FETCH_TIMEOUT_MS }
  );
  if (!r.ok) {
    logComplete(localAuditId, "failed", `peer fetch failed: ${r.reason}`);
    return { peer_node_id: peerNodeId, ok: false, reason: r.reason };
  }
  const env = r.envelope;
  const body = env.payload;
  linkAuditToPeer(localAuditId, {
    peer_node_id: peerNodeId,
    peer_audit_id: env.lamport,
    signature: env.sig,
    lamport: env.lamport,
    direction: "outbound",
  });
  logComplete(
    localAuditId,
    body.ok ? "allowed" : "denied",
    body.ok ? `received ${body.content?.kind ?? "?"} ${documentId.slice(0, 16)} (${body.content?.content.length ?? 0} chars)` : (body.reason ?? "denied")
  );
  return {
    peer_node_id: peerNodeId,
    ok: !!body.ok,
    content: body.content,
    reason: body.reason,
  };
}

/**
 * Fanout query across every paired peer (in parallel). 5s timeout per peer
 * — peers that don't respond in time return `ok: false` rather than blocking
 * the whole fanout. Results are merged and sorted by score across all peers
 * so the caller sees one ranked list rather than per-peer buckets.
 */
export async function fanoutQuery(args: {
  query: string;
  limit_per_peer?: number;
  conversation_id?: string | null;
}): Promise<{
  per_peer: PeerQueryResult[];
  merged: Array<ShareableSnippet & { peer_node_id: string; peer_label: string | null }>;
}> {
  const peers = listPeers();
  if (peers.length === 0) return { per_peer: [], merged: [] };

  const perPeer = await Promise.all(
    peers.map((p) =>
      queryPeer(p.peer_node_id, args.query, {
        limit: args.limit_per_peer ?? 10,
        conversation_id: args.conversation_id,
      })
    )
  );
  const merged: Array<ShareableSnippet & { peer_node_id: string; peer_label: string | null }> = [];
  for (const pr of perPeer) {
    if (!pr.ok) continue;
    for (const s of pr.results) {
      merged.push({ ...s, peer_node_id: pr.peer_node_id, peer_label: pr.peer_label });
    }
  }
  merged.sort((a, b) => b.score - a.score);
  return { per_peer: perPeer, merged };
}
