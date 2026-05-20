import { NextRequest, NextResponse } from "next/server";
import { getChannel, setChannel, listChannels, type ChannelType } from "@/lib/db/channels";
import { startTelegramPolling, telegramPollOnce } from "@/lib/channels/telegram";

export const runtime = "nodejs";

const TYPES: ChannelType[] = ["telegram", "twilio", "whatsapp", "email", "webhook"];

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") as ChannelType | null;
  if (type) {
    const ch = getChannel(type);
    // Mask secrets in the returned config.
    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(ch.config)) {
      masked[k] = typeof v === "string" && v.length > 8 ? v.slice(0, 4) + "••••" : v;
    }
    return NextResponse.json({ enabled: ch.enabled, config: masked });
  }
  return NextResponse.json({ channels: listChannels() });
}

export async function POST(req: NextRequest) {
  const { type, enabled, config } = await req.json();
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  // Merge with existing config so masked fields aren't overwritten with placeholders.
  const existing = getChannel(type).config;
  const merged = { ...existing };
  for (const [k, v] of Object.entries(config || {})) {
    if (typeof v === "string" && v.includes("••••")) continue;
    merged[k] = v;
  }
  setChannel(type, !!enabled, merged);
  if (type === "telegram" && enabled) {
    startTelegramPolling();
    await telegramPollOnce();
  }
  return NextResponse.json({ ok: true });
}
