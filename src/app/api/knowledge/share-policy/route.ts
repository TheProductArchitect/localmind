/**
 * GET /api/knowledge/share-policy
 * List all per-document share policies. Used by the (V6.8) UI to render the
 * sharing column on the knowledge page.
 */

import { NextResponse } from "next/server";
import { getConfigDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = getConfigDb()
    .prepare("SELECT document_id, policy, granted_peers_json, updated_at FROM knowledge_share_policy ORDER BY updated_at DESC")
    .all() as Array<{ document_id: string; policy: string; granted_peers_json: string; updated_at: number }>;
  return NextResponse.json({
    policies: rows.map((r) => {
      let granted_peers: string[] = [];
      try { granted_peers = JSON.parse(r.granted_peers_json); } catch { /* empty */ }
      return {
        document_id: r.document_id,
        policy: r.policy,
        granted_peers,
        updated_at: r.updated_at,
      };
    }),
  });
}
