import { NextRequest, NextResponse } from "next/server";
import { browseSnapshot, closeBrowseSession } from "@/lib/browse/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await browseSnapshot(id);
  if (!snap) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json(snap);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await closeBrowseSession(id);
  return NextResponse.json({ ok: true });
}
