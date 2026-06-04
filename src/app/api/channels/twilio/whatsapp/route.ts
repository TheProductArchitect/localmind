/**
 * Twilio inbound webhook for WhatsApp messages.
 *
 * Parallels /api/channels/twilio/sms — same auth model (Twilio signature
 * over the public URL), same per-message audit hook, same TwiML response.
 * The difference is that the `From` header carries a `whatsapp:` prefix
 * which we strip before comparing to the authorised number.
 *
 * Config lives in the `whatsapp` channel row (fromNumber, authorisedNumber),
 * with Twilio's accountSid/authToken/publicUrl pulled from the `twilio` row.
 */

import { NextRequest } from "next/server";
import { getChannel } from "@/lib/db/channels";
import { verifyTwilioSignature, twiml, splitSms } from "@/lib/channels/twilio";
import { handleInbound } from "@/lib/channels";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function stripWhatsAppPrefix(s: string): string {
  return s.startsWith("whatsapp:") ? s.slice("whatsapp:".length) : s;
}

export async function POST(req: NextRequest) {
  const twilio = getChannel("twilio");
  const whatsapp = getChannel("whatsapp");
  if (!whatsapp.enabled) {
    return new Response("WhatsApp channel disabled", { status: 503 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  // Twilio signs the request with the public URL the caller saw. If the user
  // hasn't set publicUrl yet, fall back to the request URL — useful in local
  // testing via ngrok, but signatures will fail in production until set.
  const signature = req.headers.get("x-twilio-signature") || "";
  const url = twilio.config.publicUrl
    ? `${twilio.config.publicUrl}/api/channels/twilio/whatsapp`
    : req.url;
  if (twilio.config.authToken && !verifyTwilioSignature(twilio.config.authToken, signature, url, params)) {
    logger.warn("twilio WhatsApp signature rejected");
    return new Response("Invalid signature", { status: 401 });
  }

  const fromRaw = params.From || "";
  const from = stripWhatsAppPrefix(fromRaw);
  const body = params.Body || "";

  // Per-channel audit row so /audit shows WhatsApp messages distinctly from
  // SMS — same shape, separate `kind`.
  const { recordInbound } = await import("@/lib/comms/twilio-api");
  recordInbound("whatsapp", from, body);

  // Authorised-number gate — silently no-op for messages from anyone else.
  // The user configures the authorised number on the WhatsApp card; we strip
  // the `whatsapp:` prefix from BOTH sides for the comparison.
  const authorised = stripWhatsAppPrefix(whatsapp.config.authorisedNumber || "");
  if (authorised && from !== authorised) {
    return new Response(twiml(""), { headers: { "content-type": "text/xml" } });
  }

  const reply = await handleInbound("whatsapp", from, body);
  // WhatsApp doesn't apply Twilio's 1600-char SMS segment math, but reusing
  // splitSms keeps very long replies from being truncated mid-thought.
  const xml = splitSms(reply)
    .map((p) => `<Message>${p.replace(/[<&]/g, "")}</Message>`)
    .join("");
  return new Response(twiml(xml), { headers: { "content-type": "text/xml" } });
}
