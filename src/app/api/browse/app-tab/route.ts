/**
 * Grant/revoke Sora's access to a live tab in the Electron shell.
 * The grant maps a CDP targetId (from the app's preload bridge) to a browse
 * session; the Sora panel then passes that sessionId with chat messages.
 */
import { NextRequest, NextResponse } from "next/server";
import { grantAppTab, revokeAppTab } from "@/lib/browse/app-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { targetId, action } = await req.json().catch(() => ({}));
  if (typeof targetId !== "string" || !targetId.trim()) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }
  if (action === "revoke") {
    await revokeAppTab(targetId.trim());
    return NextResponse.json({ ok: true });
  }
  const result = await grantAppTab(targetId.trim());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, sessionId: result.sessionId });
}
