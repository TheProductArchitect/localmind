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
// The Brain (§4.0): a plain-markdown, Obsidian-compatible vault of one file
// per entity (people, companies, topics, ideas, …). Created on first use.
export const BRAIN_DIR = path.join(DATA_DIR, "brain");
export const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export const PRESENTATIONS_DIR = path.join(ARTIFACTS_DIR, "presentations");
export const MCP_SERVERS_DIR = path.join(DATA_DIR, "mcp-servers");
export const MODELS_DIR = path.join(DATA_DIR, "models");
export const KEYS_DIR = path.join(DATA_DIR, "keys");
export const NODE_PRIVKEY_FILE = path.join(KEYS_DIR, "node.key");
export const NODE_PUBKEY_FILE = path.join(KEYS_DIR, "node.pub");
export const TLS_CERT_FILE = path.join(KEYS_DIR, "tls.crt");
export const TLS_FINGERPRINT_FILE = path.join(KEYS_DIR, "tls.sha256");

export function ensureDataDir() {
  for (const d of [DATA_DIR, BACKUPS_DIR, LOGS_DIR, TRASH_DIR, KNOWLEDGE_DIR, NOTES_DIR, BRAIN_DIR, WORKSPACES_DIR, ARTIFACTS_DIR, PRESENTATIONS_DIR, MCP_SERVERS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  // Keys directory is mode 0700 — private material lives here.
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  else try { fs.chmodSync(KEYS_DIR, 0o700); } catch { /* non-fatal on filesystems that ignore mode */ }
}
