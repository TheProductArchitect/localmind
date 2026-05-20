import { getChannel } from "../db/channels";
import { handleInbound } from ".";
import { logger } from "../logger";

const API = "https://api.telegram.org/bot";

export async function telegramSend(chatId: string | number, text: string) {
  const { config } = getChannel("telegram");
  if (!config.botToken) return;
  await fetch(`${API}${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  }).catch(() => {});
}

// Processes a Telegram update object (from webhook or long-poll).
export async function telegramProcessUpdate(update: any) {
  const msg = update.message || update.edited_message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  try {
    const reply = await handleInbound("telegram", String(chatId), msg.text);
    await telegramSend(chatId, reply);
  } catch (e: any) {
    logger.error("telegram processing failed", { error: e?.message });
    await telegramSend(chatId, "Something went wrong handling that message.");
  }
}

// Long-polling loop — used when no public webhook is configured.
let pollOffset = 0;
let polling = false;

export async function telegramPollOnce() {
  const { enabled, config } = getChannel("telegram");
  if (!enabled || !config.botToken) return;
  try {
    const r = await fetch(`${API}${config.botToken}/getUpdates?offset=${pollOffset}&timeout=0`, {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as any;
    for (const update of j.result || []) {
      pollOffset = update.update_id + 1;
      await telegramProcessUpdate(update);
    }
  } catch {
    /* network hiccup — retry next tick */
  }
}

export function startTelegramPolling() {
  if (polling) return;
  polling = true;
  setInterval(telegramPollOnce, 5000);
}
