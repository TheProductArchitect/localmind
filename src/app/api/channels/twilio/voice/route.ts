import { NextRequest } from "next/server";
import { getChannel } from "@/lib/db/channels";
import { verifyTwilioSignature, twiml } from "@/lib/channels/twilio";
import { handleInbound } from "@/lib/channels";

export const runtime = "nodejs";

// Twilio voice webhook. Uses <Gather> speech input; the Mac processes the
// transcript locally and speaks the reply back via <Say>.
export async function POST(req: NextRequest) {
  const { config } = getChannel("twilio");
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  const signature = req.headers.get("x-twilio-signature") || "";
  const url = config.publicUrl ? `${config.publicUrl}/api/channels/twilio/voice` : req.url;
  if (config.authToken && !verifyTwilioSignature(config.authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const from = params.From || "";
  if (config.authorisedNumber && from !== config.authorisedNumber) {
    return new Response(twiml("<Say>This number is not authorised.</Say><Hangup/>"), {
      headers: { "content-type": "text/xml" },
    });
  }

  const speech = params.SpeechResult;
  if (speech) {
    const reply = await handleInbound("twilio", from, speech);
    const safe = reply.replace(/[<&]/g, "").slice(0, 1500);
    return new Response(
      twiml(`<Say>${safe}</Say><Gather input="speech" action="/api/channels/twilio/voice" method="POST"><Say>Anything else?</Say></Gather>`),
      { headers: { "content-type": "text/xml" } }
    );
  }
  return new Response(
    twiml(`<Gather input="speech" action="/api/channels/twilio/voice" method="POST"><Say>LocalMind here. How can I help?</Say></Gather>`),
    { headers: { "content-type": "text/xml" } }
  );
}
