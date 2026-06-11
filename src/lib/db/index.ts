import Database from "better-sqlite3";
import { CONFIG_DB, CONVERSATIONS_DB, KNOWLEDGE_DB, ensureDataDir } from "../paths";
import { runMigrations } from "./migrations";
import { loadVecExtension } from "./vec";
import { ensureBuiltinMcpServers, autoBootstrapBuiltinsInBackground } from "../mcp/builtins";

let configDb: Database.Database | null = null;
let convDb: Database.Database | null = null;
let knowledgeDb: Database.Database | null = null;

function harden(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
}

export function getConfigDb(): Database.Database {
  if (!configDb) {
    ensureDataDir();
    configDb = new Database(CONFIG_DB);
    harden(configDb);
    runMigrations(configDb, "config");
    // Seed/refresh built-in MCP servers (Secure Browser, etc.). Idempotent —
    // safe on every boot, and keeps metadata in sync with the source table.
    ensureBuiltinMcpServers(configDb);
    // First-run UX: kick off bootstrap for any built-in that isn't installed
    // yet (e.g. Secure Browser's venv on a fresh checkout). Fire-and-forget;
    // progress is exposed via /api/mcp/servers and the MCP page surfaces it.
    autoBootstrapBuiltinsInBackground();
  }
  return configDb;
}

export function getConvDb(): Database.Database {
  if (!convDb) {
    ensureDataDir();
    convDb = new Database(CONVERSATIONS_DB);
    harden(convDb);
    runMigrations(convDb, "conversations");
  }
  return convDb;
}

export function getKnowledgeDb(): Database.Database {
  if (!knowledgeDb) {
    ensureDataDir();
    knowledgeDb = new Database(KNOWLEDGE_DB);
    harden(knowledgeDb);
    loadVecExtension(knowledgeDb);
    runMigrations(knowledgeDb, "knowledge");
  }
  return knowledgeDb;
}

// Closes all database connections — used before a backup restore.
export function closeAllDbs() {
  for (const db of [configDb, convDb, knowledgeDb]) {
    try {
      db?.pragma("wal_checkpoint(TRUNCATE)");
      db?.close();
    } catch {}
  }
  configDb = null;
  convDb = null;
  knowledgeDb = null;
}

export function integrityCheck(): { db: string; ok: boolean; detail: string }[] {
  const results: { db: string; ok: boolean; detail: string }[] = [];
  for (const [name, get] of [
    ["config", getConfigDb], ["conversations", getConvDb], ["knowledge", getKnowledgeDb],
  ] as const) {
    try {
      const r = get().pragma("integrity_check") as { integrity_check: string }[];
      const detail = r[0]?.integrity_check || "unknown";
      results.push({ db: name, ok: detail === "ok", detail });
    } catch (e: any) {
      results.push({ db: name, ok: false, detail: e?.message || "check failed" });
    }
  }
  return results;
}
