import { NextRequest, NextResponse } from "next/server";
import { getChannel } from "@/lib/db/channels";
import { telegramProcessUpdate } from "@/lib/channels/telegram";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Telegram webhook. The secret token is verified per the Telegram Bot API.
export async function POST(req: NextRequest) {
  const { config } = getChannel("telegram");
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (config.webhookSecret && secret !== config.webhookSecret) {
    logger.warn("telegram webhook signature rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const update = await req.json();
  // Respond fast; process in the background.
  telegramProcessUpdate(update).catch(() => {});
  return NextResponse.json({ ok: true });
}
