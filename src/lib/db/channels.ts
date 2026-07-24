import { getConfigDb } from ".";
import { encrypt, decrypt } from "../crypto";

export type ChannelType = "telegram" | "twilio" | "whatsapp" | "email" | "webhook" | "unipile";

export type ChannelRow = {
  channel_type: string;
  enabled: number;
  config: string;
  last_message_at: number | null;
};

export function getChannel(type: ChannelType): { enabled: boolean; config: Record<string, any> } {
  const row = getConfigDb()
    .prepare("SELECT * FROM communication_channels WHERE channel_type=?")
    .get(type) as ChannelRow | undefined;
  if (!row) return { enabled: false, config: {} };
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(decrypt(row.config));
  } catch {
    try { config = JSON.parse(row.config); } catch {}
  }
  return { enabled: !!row.enabled, config };
}

export function setChannel(type: ChannelType, enabled: boolean, config: Record<string, any>) {
  getConfigDb()
    .prepare(
      "INSERT INTO communication_channels (channel_type,enabled,config,last_message_at) VALUES (?,?,?,NULL) " +
        "ON CONFLICT(channel_type) DO UPDATE SET enabled=excluded.enabled, config=excluded.config"
    )
    .run(type, enabled ? 1 : 0, encrypt(JSON.stringify(config)));
}

export function listChannels(): { type: string; enabled: boolean; last_message_at: number | null }[] {
  return (getConfigDb().prepare("SELECT * FROM communication_channels").all() as ChannelRow[]).map((r) => ({
    type: r.channel_type,
    enabled: !!r.enabled,
    last_message_at: r.last_message_at,
  }));
}

export function markChannelMessage(type: ChannelType) {
  getConfigDb()
    .prepare("UPDATE communication_channels SET last_message_at=? WHERE channel_type=?")
    .run(Date.now(), type);
}
