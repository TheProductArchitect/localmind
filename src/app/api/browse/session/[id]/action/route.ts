import { NextRequest, NextResponse } from "next/server";
import { browseAction, browseSnapshot, ensureBrowseSession, type BrowseAction } from "@/lib/browse/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pathId } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body as BrowseAction;
  if (!action?.type) {
    return NextResponse.json({ error: "action.type is required." }, { status: 400 });
  }

  const sessionId = await ensureBrowseSession(pathId === "new" ? null : pathId);
  const result = await browseAction(sessionId, action);
  if (!result.ok) return NextResponse.json({ error: result.error, sessionId }, { status: 400 });
  const snap = await browseSnapshot(sessionId);
  return NextResponse.json(snap);
}
