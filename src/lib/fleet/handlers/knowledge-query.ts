/**
 * /fleet/knowledge-query — peer asks us to search our shareable knowledge.
 *
 * Per V6 plan §9, every external query is audited (`external_query` action
 * type). Snippets ≤300 chars are returned for matches in documents/notes
 * with policy >= `fleet-queryable`. The peer never sees content from
 * documents marked `private` or for which they're not in the granted list.
 *
 * Auditing happens BEFORE the search runs so the request is in our chain
 * even if the search throws.
 */

import { searchShareable, type ShareableSnippet } from "../../db/knowledge-share";
import { logStartFederated, logComplete } from "../../agent/audit-logger";

export type KnowledgeQueryRequest = {
  query: string;
  limit?: number;
};

export type KnowledgeQueryResponse = {
  ok: boolean;
  results: ShareableSnippet[];
  total: number;
  reason?: string;
};

export function handleKnowledgeQuery(args: {
  envelope_sender: string;
  envelope_signature: string;
  envelope_lamport: number;
  envelope_initiator_audit_id?: number;
  payload: KnowledgeQueryRequest;
}): KnowledgeQueryResponse {
  const q = String(args.payload.query ?? "").trim();
  if (!q) return { ok: false, results: [], total: 0, reason: "Empty query." };

  // Audit BEFORE search. The peer_audit_id we get is the envelope's lamport
  // (peers don't necessarily pre-allocate an audit id for one-shot reads);
  // we still record their signature so the link is verifiable.
  const auditId = logStartFederated(
    {
      actionType: "external_query",
      toolName: "knowledge_share",
      input: { query: q.slice(0, 500), limit: args.payload.limit ?? 10 },
      conversationId: null,
      approvedBy: "rule",
    },
    {
      peer_node_id: args.envelope_sender,
      peer_audit_id: args.envelope_initiator_audit_id ?? args.envelope_lamport,
      signature: args.envelope_signature,
      lamport: args.envelope_lamport,
      direction: "inbound",
    }
  );

  try {
    const results = searchShareable({
      peer_node_id: args.envelope_sender,
      query: q,
      limit: args.payload.limit,
    });
    logComplete(auditId, "allowed", `Returned ${results.length} snippet(s)`);
    return { ok: true, results, total: results.length };
  } catch (e) {
    const reason = (e as Error).message || "search threw";
    logComplete(auditId, "failed", reason);
    return { ok: false, results: [], total: 0, reason };
  }
}
