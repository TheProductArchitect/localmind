/**
 * POST /api/knowledge/peer-search
 * Body: { query, limit_per_peer? }
 *
 * Fans out a knowledge query to every paired peer in parallel with a 5s
 * timeout per peer (decision §14.5). Returns per-peer results + a merged
 * score-sorted list ready for the agent or UI to consume.
 *
 * This is the user-facing entry point. The agent's knowledge tool (V6.8 will
 * add it) will call into this same code path so all federated knowledge
 * access goes through one audited surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fanoutQuery } from "@/lib/fleet/knowledge";

export const runtime = "nodejs";

const Body = z.object({
  query: z.string().min(1).max(500),
  limit_per_peer: z.number().int().min(1).max(25).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid peer-search payload." }, { status: 400 });
  }
  const result = await fanoutQuery({
    query: parsed.data.query,
    limit_per_peer: parsed.data.limit_per_peer,
  });
  return NextResponse.json(result);
}
