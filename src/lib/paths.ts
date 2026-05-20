import path from "path";
import os from "os";
import fs from "fs";

export const DATA_DIR = process.env.LOCALMIND_DATA_DIR || path.join(os.homedir(), ".localmind");
export const CONFIG_DB = path.join(DATA_DIR, "config.db");
export const CONVERSATIONS_DB = path.join(DATA_DIR, "conversations.db");
export const KNOWLEDGE_DB = path.join(DATA_DIR, "knowledge.db");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const TRASH_DIR = path.join(DATA_DIR, "trash");
export const KEYDATA_FILE = path.join(DATA_DIR, "keydata");
export const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge");
export const NOTES_DIR = path.join(KNOWLEDGE_DIR, "notes");
export const MCP_SERVERS_DIR = path.join(DATA_DIR, "mcp-servers");

export function ensureDataDir() {
  for (const d of [DATA_DIR, BACKUPS_DIR, LOGS_DIR, TRASH_DIR, KNOWLEDGE_DIR, NOTES_DIR, MCP_SERVERS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
