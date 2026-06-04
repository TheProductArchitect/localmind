/**
 * /fleet/audit-query — peer asks us to return one of our audit rows so they
 * can verify a cross-reference recorded in their own fleet_audit_links.
 *
 * Privacy: we ONLY release rows the requester has a recorded link to. That
 * way the audit-query channel can't be used to scrape our entire log — a
 * peer has to already have a cross-reference (which they only got because
 * we wrote it during a delegation they participated in).
 *
 * Hash chain integrity: we return the row + its row_hash + an optional
 * "chain verified" attestation so the requester can confirm our chain is
 * intact up to that row. They re-compute the hash chain locally over the
 * row's `input`/`status` fields if they want defence in depth.
 */

import { getConfigDb } from "../../db";
import { findAuditLinkByPeerRef } from "../../db/fleet";
import { verifyChain } from "../../agent/audit-logger";
import type { AuditRow } from "../../db/queries";

export type AuditQueryRequest = {
  /** The row id ON OUR side (the responder). The requester knows this from
   *  their fleet_audit_links.peer_audit_id field. */
  local_audit_id: number;
};

export type AuditQueryResponse = {
  ok: boolean;
  reason?: string;
  /** Full audit row payload (without prev hash to keep payload small). */
  row?: AuditRow;
  /** Whether OUR chain is verifiable up through this row. */
  chain_ok?: boolean;
  /** If the chain is broken, the first bad id (so the verifier knows the
   *  boundary). */
  first_bad_id?: number;
};

export function handleAuditQuery(args: {
  envelope_sender: string;
  payload: AuditQueryRequest;
}): AuditQueryResponse {
  const id = Number(args.payload.local_audit_id);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, reason: "Invalid local_audit_id" };
  }

  // Privacy gate: the requesting peer must already have a cross-reference to
  // this audit row. Otherwise we never disclose it.
  const link = findAuditLinkByPeerRef(args.envelope_sender, id);
  if (!link) {
    return { ok: false, reason: "No cross-reference exists for that audit id with this peer." };
  }

  const row = getConfigDb()
    .prepare("SELECT * FROM audit_log WHERE id=?")
    .get(id) as AuditRow | undefined;
  if (!row) {
    return { ok: false, reason: "Audit row not found." };
  }

  // Verify our own chain end-to-end on this query — cheap-ish for typical logs,
  // and gives the requester a strong signal. If you have millions of audit
  // rows and this becomes too expensive, swap for a range-verify in V6.5.
  const chain = verifyChain();
  return {
    ok: true,
    row,
    chain_ok: chain.ok,
    first_bad_id: chain.firstBadId,
  };
}
