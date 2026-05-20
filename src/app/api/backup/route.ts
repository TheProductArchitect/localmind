import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { CONFIG_DB, CONVERSATIONS_DB, BACKUPS_DIR, ensureDataDir } from "@/lib/paths";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  ensureDataDir();
  const snapshots = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith("snapshot-"))
    .sort()
    .reverse()
    .map((f) => ({
      name: f,
      timestamp: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
    }));
  return NextResponse.json({ snapshots });
}

export async function POST() {
  ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(BACKUPS_DIR, `snapshot-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (fs.existsSync(CONFIG_DB)) fs.copyFileSync(CONFIG_DB, path.join(dir, "config.db"));
    if (fs.existsSync(CONVERSATIONS_DB))
      fs.copyFileSync(CONVERSATIONS_DB, path.join(dir, "conversations.db"));
    logger.info("manual backup created", { dir });
    return NextResponse.json({ ok: true, snapshot: `snapshot-${stamp}` });
  } catch (e: any) {
    return NextResponse.json({ error: "Backup failed: " + (e?.message || "unknown") }, { status: 500 });
  }
}
