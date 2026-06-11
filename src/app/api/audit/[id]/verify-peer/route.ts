/**
 * GET /api/audit/[id]/verify-peer — for any local audit row that has at least
 * one fleet_audit_links entry, contact each linked peer in turn and ask for
 * their corresponding audit row. Verify:
 *
 *   - the response envelope is signed by the peer (sendToPeer already does this)
 *   - the peer's chain_ok is true
 *   - the row's content roughly matches what we recorded (timestamp window,
 *     action_type, tool_name — exact byte equality isn't expected because
 *     the peer's row has THEIR fields, not ours)
 *
 * Surfaces the per-peer verdicts so the audit page can render a green/red
 * status per linked peer.
 */

import { NextRequest, NextResponse } from "next/server";
import { listAuditLinksFor } from "@/lib/db/fleet";
import { sendToPeer } from "@/lib/fleet/peer-client";
import type { AuditQueryRequest, AuditQueryResponse } from "@/lib/fleet/handlers/audit-query";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const localAuditId = Number(params.id);
  if (!Number.isFinite(localAuditId) || localAuditId <= 0) {
    return NextResponse.json({ error: "Invalid audit id." }, { status: 400 });
  }

  const links = listAuditLinksFor(localAuditId);
  if (links.length === 0) {
    return NextResponse.json({
      local_audit_id: localAuditId,
      verifications: [],
      note: "No cross-references — this row is purely local.",
    });
  }

  const verifications: Array<{
    peer_node_id: string;
    direction: "inbound" | "outbound";
    peer_audit_id: number;
    ok: boolean;
    chain_ok?: boolean;
    reason?: string;
    row_excerpt?: { action_type: string; tool_name: string; status: string; timestamp: number };
  }> = [];

  for (const link of links) {
    const req: AuditQueryRequest = { local_audit_id: link.peer_audit_id };
    const r = await sendToPeer<AuditQueryRequest, AuditQueryResponse>(
      link.peer_node_id,
      "audit-query",
      req,
      { timeoutMs: 6000 }
    );
    if (!r.ok) {
      verifications.push({
        peer_node_id: link.peer_node_id,
        direction: link.direction,
        peer_audit_id: link.peer_audit_id,
        ok: false,
        reason: r.reason,
      });
      continue;
    }
    const body = r.envelope.payload;
    if (!body.ok || !body.row) {
      verifications.push({
        peer_node_id: link.peer_node_id,
        direction: link.direction,
        peer_audit_id: link.peer_audit_id,
        ok: false,
        reason: body.reason ?? "peer refused to release the row",
      });
      continue;
    }
    verifications.push({
      peer_node_id: link.peer_node_id,
      direction: link.direction,
      peer_audit_id: link.peer_audit_id,
      ok: true,
      chain_ok: body.chain_ok,
      row_excerpt: {
        action_type: body.row.action_type,
        tool_name: body.row.tool_name,
        status: body.row.status,
        timestamp: body.row.timestamp,
      },
    });
  }

  return NextResponse.json({
    local_audit_id: localAuditId,
    verifications,
    all_ok: verifications.every((v) => v.ok && v.chain_ok !== false),
  });
}
