import crypto from "crypto";
import { getChannel, listChannels } from "../db/channels";
import { handleInbound } from ".";
import { logger } from "../logger";
import { getSettings } from "../db/queries";

/**
 * Unipile — opt-in cloud messaging relay (LinkedIn / WhatsApp / email / …).
 *
 * Base URL: https://{dsn}/api/v1/… where `dsn` is the dashboard host
 * (e.g. api1.unipile.com:13111). Auth: X-API-KEY.
 *
 * Off by default. Messages transit Unipile's cloud — respect channel.enabled
 * and the global web-access kill switch.
 */

function normalizeDsn(dsn: string): string {
  const raw = (dsn || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return raw;
}

export function unipileBaseUrl(dsn?: string): string | null {
  const host = normalizeDsn(dsn || getChannel("unipile").config.dsn || "");
  if (!host) return null;
  return `https://${host}/api/v1`;
}

export function verifyUnipileSignature(
  secret: string,
  signature: string,
  rawBody: string
): boolean {
  // Stub: HMAC-SHA256 hex of raw body, compared to Unipile-Auth / X-Unipile-Signature.
  // Real Unipile webhook schemes vary by event version; tighten once confirmed.
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signature.replace(/^sha256=/i, ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function unipileSend(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const { enabled, config } = getChannel("unipile");
  if (!enabled) return { ok: false, error: "Unipile channel is disabled" };
  if (getSettings().web_access_killed) {
    return { ok: false, error: "Web access kill switch is on — Unipile sends blocked" };
  }
  const base = unipileBaseUrl(config.dsn);
  const apiKey = config.apiKey as string | undefined;
  if (!base || !apiKey) return { ok: false, error: "Unipile DSN or API key not configured" };
  if (!chatId) return { ok: false, error: "chat_id required" };

  try {
    const form = new FormData();
    form.set("text", text.slice(0, 8000));
    const r = await fetch(`${base}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, accept: "application/json" },
      body: form,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, error: `HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unipile send failed" };
  }
}

/** Inbound stub — extract chat/message fields from Unipile webhook payloads. */
export async function unipileProcessInbound(payload: any): Promise<void> {
  const { enabled } = getChannel("unipile");
  if (!enabled) {
    logger.warn("unipile inbound ignored — channel disabled");
    return;
  }
  if (getSettings().web_access_killed) {
    logger.warn("unipile inbound ignored — web access kill switch");
    return;
  }

  const event = payload?.event || payload?.account_type || "message";
  const data = payload?.data || payload;
  const text =
    data?.message ||
    data?.text ||
    data?.body ||
    payload?.message ||
    payload?.text ||
    "";
  const chatId =
    data?.chat_id ||
    data?.chatId ||
    payload?.chat_id ||
    data?.account_info?.chat_id ||
    "";
  const from =
    data?.sender_id ||
    data?.from ||
    data?.attendee_id ||
    String(chatId || "unknown");

  if (!text || !chatId) {
    logger.info("unipile inbound stub: no text/chat_id", { event });
    return;
  }

  try {
    const reply = await handleInbound("unipile", String(from), String(text));
    await unipileSend(String(chatId), reply);
  } catch (e: any) {
    logger.error("unipile processing failed", { error: e?.message });
    await unipileSend(String(chatId), "Something went wrong handling that message.");
  }
}

export function unipileStatus(): {
  enabled: boolean;
  configured: boolean;
  dsn_set: boolean;
  cloud: true;
  last_message_at: number | null;
} {
  const { enabled, config } = getChannel("unipile");
  const row = listChannels().find((c) => c.type === "unipile");
  return {
    enabled,
    configured: !!(config.dsn && config.apiKey),
    dsn_set: !!config.dsn,
    cloud: true,
    last_message_at: row?.last_message_at ?? null,
  };
}
