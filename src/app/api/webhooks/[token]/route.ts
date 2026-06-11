import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db/queries";
import { hashToken } from "@/lib/auth/jwt";
import { handleInbound } from "@/lib/channels";

export const runtime = "nodejs";

// Generic inbound webhook. Any local service can POST { message } here.
export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = await paramsPromise;
  const s = getSettings();
  if (!s.api_token_hash || hashToken(params.token) !== s.api_token_hash) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.message !== "string") {
    return NextResponse.json({ error: "message field required" }, { status: 400 });
  }
  const reply = await handleInbound("webhook", body.source || "webhook", body.message);
  return NextResponse.json({ reply });
}
