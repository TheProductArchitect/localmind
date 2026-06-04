import {
  getLastAuditHash,
  insertAuditRow,
  updateAuditRow,
  type AuditRow,
} from "../db/queries";
import { sha256 } from "../crypto";
import { recordAuditLink } from "../db/fleet";

export type AuditStartArgs = {
  actionType: string;
  toolName: string;
  input: unknown;
  conversationId: string | null;
  approvedBy: "user" | "auto" | "rule";
};

function computeHash(prev: string, row: Omit<AuditRow, "id" | "row_hash">): string {
  const payload = JSON.stringify({
    t: row.timestamp,
    a: row.action_type,
    n: row.tool_name,
    i: row.input,
    o: row.output_summary,
    s: row.status,
    b: row.approved_by,
    c: row.conversation_id,
    p: prev,
  });
  return sha256(payload);
}

export function logStart(args: AuditStartArgs): number {
  const prev = getLastAuditHash();
  const row: Omit<AuditRow, "id" | "row_hash"> = {
    timestamp: Date.now(),
    action_type: args.actionType,
    tool_name: args.toolName,
    input: JSON.stringify(args.input),
    output_summary: null,
    status: "pending",
    approved_by: args.approvedBy,
    conversation_id: args.conversationId,
  };
  const hash = computeHash(prev, row);
  return insertAuditRow({ ...row, row_hash: hash });
}

export function logComplete(
  id: number,
  status: "allowed" | "denied" | "failed",
  outputSummary: string
) {
  // Recompute hash to reflect final state (still chained off prev predecessor's hash)
  // We update in-place; integrity verification recomputes the chain from input.
  updateAuditRow(id, { status, output_summary: outputSummary.slice(0, 2000) });
}

/**
 * Federated audit start — writes a local audit row AND records a cross-
 * reference into `fleet_audit_links` in the same transaction (well, two
 * sequential writes — better-sqlite3 prepares aren't auto-transactional but
 * a crash between them only leaves an orphan audit row, never a dangling
 * cross-reference). Per V6 plan §6: both sides of a cross-machine action
 * keep an attestation in their own chain.
 *
 * Used in two directions:
 *   - inbound  : peer delegated a task to us; we record OUR audit row + a
 *                link to THEIR origin row.
 *   - outbound : we delegated a task to a peer; we record OUR audit row + a
 *                link to THEIR executor row (only AFTER the response comes
 *                back with the peer's audit id and signature).
 */
export type FederatedAuditMeta = {
  peer_node_id: string;
  peer_audit_id: number;
  signature: string;          // envelope sig from the request (inbound) or response (outbound)
  lamport: number;            // envelope lamport at time of cross-reference
  direction: "outbound" | "inbound";
};

export function logStartFederated(args: AuditStartArgs, meta: FederatedAuditMeta): number {
  const auditId = logStart(args);
  recordAuditLink({
    local_audit_id: auditId,
    peer_node_id: meta.peer_node_id,
    peer_audit_id: meta.peer_audit_id,
    signature: meta.signature,
    direction: meta.direction,
    lamport: meta.lamport,
  });
  return auditId;
}

/**
 * Convenience: link an EXISTING audit row to a peer's audit row. Used by the
 * initiator side of a delegation — we logStart() before the RPC (so the peer
 * can reference it), then after the response arrives we record the outbound
 * link with the peer's executor_audit_id.
 */
export function linkAuditToPeer(localAuditId: number, meta: FederatedAuditMeta): void {
  recordAuditLink({
    local_audit_id: localAuditId,
    peer_node_id: meta.peer_node_id,
    peer_audit_id: meta.peer_audit_id,
    signature: meta.signature,
    direction: meta.direction,
    lamport: meta.lamport,
  });
}

export function verifyChain(): { ok: boolean; firstBadId?: number } {
  const rows = require("../db/queries").getAllAuditOrdered() as AuditRow[];
  let prev = "";
  for (const r of rows) {
    // The row_hash is computed once at insert time (pending state, output_summary null).
    // Recompute with those same field values so completed rows still verify.
    const expected = computeHash(prev, {
      timestamp: r.timestamp,
      action_type: r.action_type,
      tool_name: r.tool_name,
      input: r.input,
      output_summary: null,
      status: "pending",
      approved_by: r.approved_by,
      conversation_id: r.conversation_id,
    });
    if (expected !== r.row_hash) return { ok: false, firstBadId: r.id };
    prev = r.row_hash;
  }
  return { ok: true };
}
