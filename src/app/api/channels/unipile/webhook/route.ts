import { NextRequest, NextResponse } from "next/server";
import { getChannel } from "@/lib/db/channels";
import { unipileProcessInbound, verifyUnipileSignature } from "@/lib/channels/unipile";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Unipile inbound webhook.
 * Requires a configured webhookSecret — unsigned requests are rejected (public route).
 */
export async function POST(req: NextRequest) {
  const { enabled, config } = getChannel("unipile");
  if (!enabled) {
    return NextResponse.json({ error: "Unipile channel disabled" }, { status: 403 });
  }

  const raw = await req.text();
  const secret = String(config.webhookSecret || "").trim();
  if (!secret) {
    logger.warn("unipile webhook rejected — webhookSecret not configured");
    return NextResponse.json(
      { error: "Webhook secret required. Configure it in Settings → Channels before enabling Unipile inbound." },
      { status: 503 }
    );
  }

  const signature =
    req.headers.get("unipile-auth") ||
    req.headers.get("x-unipile-signature") ||
    req.headers.get("Unipile-Signature") ||
    "";
  if (!verifyUnipileSignature(secret, signature, raw)) {
    logger.warn("unipile webhook signature rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Respond fast; process in the background.
  unipileProcessInbound(payload).catch(() => {});
  return NextResponse.json({ ok: true });
}
