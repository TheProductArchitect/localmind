import { NextRequest } from "next/server";
import { getChannel } from "@/lib/db/channels";
import { verifyTwilioSignature, twiml, splitSms } from "@/lib/channels/twilio";
import { handleInbound } from "@/lib/channels";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { config } = getChannel("twilio");
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  const signature = req.headers.get("x-twilio-signature") || "";
  const url = config.publicUrl ? `${config.publicUrl}/api/channels/twilio/sms` : req.url;
  if (config.authToken && !verifyTwilioSignature(config.authToken, signature, url, params)) {
    logger.warn("twilio SMS signature rejected");
    return new Response("Invalid signature", { status: 401 });
  }

  const from = params.From || "";
  const { recordInbound } = await import("@/lib/comms/twilio-api");
  recordInbound("sms", from, params.Body || "");
  if (config.authorisedNumber && from !== config.authorisedNumber) {
    return new Response(twiml(""), { headers: { "content-type": "text/xml" } });
  }

  const reply = await handleInbound("twilio", from, params.Body || "");
  const body = splitSms(reply).map((p) => `<Message>${p.replace(/[<&]/g, "")}</Message>`).join("");
  return new Response(twiml(body), { headers: { "content-type": "text/xml" } });
}
