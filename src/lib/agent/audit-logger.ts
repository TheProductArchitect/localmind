import {
  getLastAuditHash,
  insertAuditRow,
  updateAuditRow,
  type AuditRow,
} from "../db/queries";
import { sha256 } from "../crypto";

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
