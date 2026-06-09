/**
 * GET    /api/agent/memory/[personaId]              — list memory for a persona
 * POST   /api/agent/memory/[personaId]              — user-authored entry
 * PATCH  /api/agent/memory/[personaId]?id=<memid>   — promote proposed → committed
 * DELETE /api/agent/memory/[personaId]?id=<memid>   — retire (soft delete)
 *
 * Only the user writes via these endpoints. Sora writes via the
 * record_agent_lesson tool; the critic writes via its internal pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listMemory, addMemory, setMemoryStatus, retireMemory, getMemory,
} from "@/lib/db/agent-memory";
import { getPersona } from "@/lib/db/personas";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ personaId: string }> }) {
  const params = await paramsPromise;
  if (!getPersona(params.personaId)) {
    return NextResponse.json({ error: "Persona not found." }, { status: 404 });
  }
  const status = req.nextUrl.searchParams.get("status") as
    | "committed" | "proposed" | "retired" | null;
  const items = listMemory(params.personaId, status ? { status } : undefined);
  return NextResponse.json({ items });
}

const PostBody = z.object({
  kind: z.enum(["lesson", "warning", "preference", "fact"]).default("lesson"),
  content: z.string().min(1).max(2000),
  status: z.enum(["committed", "proposed"]).default("committed"),
});

export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ personaId: string }> }) {
  const params = await paramsPromise;
  if (!getPersona(params.personaId)) {
    return NextResponse.json({ error: "Persona not found." }, { status: 404 });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const created = addMemory({
    persona_id: params.personaId,
    kind: parsed.data.kind,
    content: parsed.data.content.trim(),
    status: parsed.data.status,
    created_by: "user",
  });
  return NextResponse.json({ memory: created });
}

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ personaId: string }> }) {
  const params = await paramsPromise;
  const memId = req.nextUrl.searchParams.get("id");
  if (!memId) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const m = getMemory(memId);
  if (!m || m.persona_id !== params.personaId) {
    return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
  }
  // Promote proposed → committed (the user-review path for critic findings).
  if (m.status !== "proposed") {
    return NextResponse.json({ error: `Cannot promote a ${m.status} entry.` }, { status: 400 });
  }
  setMemoryStatus(memId, "committed");
  return NextResponse.json({ ok: true, memory: getMemory(memId) });
}

export async function DELETE(req: NextRequest, { params: paramsPromise }: { params: Promise<{ personaId: string }> }) {
  const params = await paramsPromise;
  const memId = req.nextUrl.searchParams.get("id");
  if (!memId) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const m = getMemory(memId);
  if (!m || m.persona_id !== params.personaId) {
    return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
  }
  retireMemory(memId);
  return NextResponse.json({ ok: true });
}
