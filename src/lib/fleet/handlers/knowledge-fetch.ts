/**
 * /fleet/knowledge-fetch — peer asks for full content of a specific
 * document. Only allowed if policy is `fleet-readable` (not just queryable),
 * which is a stricter consent: the peer must have already learnt about the
 * doc through a previous query OR the user explicitly granted them by id.
 *
 * Like knowledge-query, audit-before-fetch — the request is recorded even
 * if the fetch refuses or throws.
 */

import { fetchShareable, type ShareableContent } from "../../db/knowledge-share";
import { logStartFederated, logComplete } from "../../agent/audit-logger";

export type KnowledgeFetchRequest = {
  document_id: string;
};

export type KnowledgeFetchResponse = {
  ok: boolean;
  content?: ShareableContent;
  reason?: string;
};

export function handleKnowledgeFetch(args: {
  envelope_sender: string;
  envelope_signature: string;
  envelope_lamport: number;
  envelope_initiator_audit_id?: number;
  payload: KnowledgeFetchRequest;
}): KnowledgeFetchResponse {
  const docId = String(args.payload.document_id ?? "").trim();
  if (!docId) return { ok: false, reason: "document_id is required" };

  const auditId = logStartFederated(
    {
      actionType: "external_fetch",
      toolName: "knowledge_share",
      input: { document_id: docId },
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

  const result = fetchShareable({
    peer_node_id: args.envelope_sender,
    document_id: docId,
  });
  if (!result.ok) {
    logComplete(auditId, "denied", result.reason);
    return { ok: false, reason: result.reason };
  }
  logComplete(auditId, "allowed", `Released ${result.content.kind} ${docId.slice(0, 16)} (${result.content.content.length} chars)`);
  return { ok: true, content: result.content };
}
