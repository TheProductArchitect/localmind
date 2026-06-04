/**
 * GET    /api/knowledge/share-policy/[id] — current policy for a doc/note
 * PUT    /api/knowledge/share-policy/[id] — set policy + (optional) granted peers
 * DELETE /api/knowledge/share-policy/[id] — revert to private (deletes the row)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConfigDb } from "@/lib/db";
import { getKnowledgePolicy, setKnowledgePolicy } from "@/lib/db/fleet";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = getKnowledgePolicy(params.id);
  if (!row) {
    return NextResponse.json({
      document_id: params.id,
      policy: "private",
      granted_peers: [],
      inherited: true,
    });
  }
  let granted_peers: string[] = [];
  try { granted_peers = JSON.parse(row.granted_peers_json); } catch { /* empty */ }
  return NextResponse.json({
    document_id: row.document_id,
    policy: row.policy,
    granted_peers,
    updated_at: row.updated_at,
    inherited: false,
  });
}

const PutBody = z.object({
  policy: z.enum(["private", "fleet-readable", "fleet-queryable"]),
  granted_peers: z.array(z.string().min(1).max(128)).max(64).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid policy payload." }, { status: 400 });
  }
  const row = setKnowledgePolicy({
    document_id: params.id,
    policy: parsed.data.policy,
    granted_peers: parsed.data.granted_peers ?? [],
  });
  let granted_peers: string[] = [];
  try { granted_peers = JSON.parse(row.granted_peers_json); } catch { /* empty */ }
  return NextResponse.json({
    document_id: row.document_id,
    policy: row.policy,
    granted_peers,
    updated_at: row.updated_at,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  getConfigDb().prepare("DELETE FROM knowledge_share_policy WHERE document_id=?").run(params.id);
  return NextResponse.json({ ok: true, document_id: params.id, reverted_to: "private" });
}
