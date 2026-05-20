import { NextRequest, NextResponse } from "next/server";
import { verifyTwilioCreds, sendSms, makeCall, getLastInbound } from "@/lib/comms/twilio-api";
import { getChannel } from "@/lib/db/channels";
import { getTunnelUrl } from "@/lib/comms/tunnel";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("inbound");
  if (channel) return NextResponse.json({ last: getLastInbound(channel) });
  return NextResponse.json({ tunnelUrl: getTunnelUrl() });
}

export async function POST(req: NextRequest) {
  const { action, sid, token, to } = await req.json();
  const cfg = getChannel("twilio").config;

  if (action === "verify") {
    return NextResponse.json(await verifyTwilioCreds(sid || cfg.accountSid, token || cfg.authToken));
  }
  if (action === "test-sms") {
    const target = to || cfg.authorisedNumber;
    if (!target) return NextResponse.json({ ok: false, error: "No phone number configured." });
    return NextResponse.json(await sendSms(target, "LocalMind test message — reply to confirm two-way SMS works."));
  }
  if (action === "test-call") {
    const target = to || cfg.authorisedNumber;
    const tunnel = getTunnelUrl();
    if (!target) return NextResponse.json({ ok: false, error: "No phone number configured." });
    if (!tunnel) return NextResponse.json({ ok: false, error: "Start the tunnel first." });
    return NextResponse.json(await makeCall(target, `${tunnel}/api/channels/twilio/voice`));
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
