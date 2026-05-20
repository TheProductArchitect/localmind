import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getChannel } from "@/lib/db/channels";
import { handleInbound } from "@/lib/channels";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Meta webhook verification handshake.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { config } = getChannel("whatsapp");
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === config.verifyToken) {
    return new Response(sp.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const { config } = getChannel("whatsapp");
  const raw = await req.text();

  // Verify the X-Hub-Signature-256 HMAC against the app secret.
  if (config.appSecret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", config.appSecret).update(raw).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      logger.warn("whatsapp webhook signature rejected");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages || [];
  const { recordInbound } = await import("@/lib/comms/twilio-api");
  for (const m of messages) {
    if (m.type === "text" && m.text?.body) {
      recordInbound("whatsapp", m.from, m.text.body);
      handleInbound("whatsapp", m.from, m.text.body)
        .then(async (reply) => {
          // Reply via the WhatsApp Cloud API.
          if (config.phoneNumberId && config.accessToken) {
            await fetch(`https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`, {
              method: "POST",
              headers: { Authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
              body: JSON.stringify({ messaging_product: "whatsapp", to: m.from, text: { body: reply.slice(0, 4000) } }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }
  return NextResponse.json({ ok: true });
}
