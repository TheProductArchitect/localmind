import { logger } from "../logger";

// Delivers a message to a channel for scheduled tasks, monitors, and workflows.
export async function deliver(channel: string, message: string) {
  try {
    if (channel === "telegram") {
      const { getChannel } = await import("../db/channels");
      const { telegramSend } = await import("../channels/telegram");
      const { config } = getChannel("telegram");
      if (config.defaultChatId) await telegramSend(config.defaultChatId, message);
    } else if (channel === "email") {
      const { sendDigestEmail } = await import("../channels/email-digest");
      await sendDigestEmail("LocalMind notification", message);
    }
    // "browser" / "log" just record to the app log; the dashboard surfaces these.
    logger.info("delivery", { channel, message: message.slice(0, 200) });
  } catch (e: any) {
    logger.error("delivery failed", { channel, error: e?.message });
  }
}
