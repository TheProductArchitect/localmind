import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { CONFIG_DB, CONVERSATIONS_DB, KNOWLEDGE_DB, BACKUPS_DIR } from "@/lib/paths";
import { closeAllDbs } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const SNAPSHOT_RE = /^snapshot-[\w:.-]+$/;

export async function POST(req: NextRequest) {
  const { snapshot } = await req.json();
  if (!snapshot || !SNAPSHOT_RE.test(snapshot)) {
    return NextResponse.json(
      { status: 400, error: "bad_request", message: "Invalid snapshot name." },
      { status: 400 }
    );
  }
  const dir = path.join(BACKUPS_DIR, snapshot);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return NextResponse.json(
      { status: 404, error: "not_found", message: "That snapshot does not exist." },
      { status: 404 }
    );
  }

  try {
    // Safety net: snapshot the current live databases before overwriting.
    const preDir = path.join(BACKUPS_DIR, `pre-restore-${Date.now()}`);
    fs.mkdirSync(preDir, { recursive: true });
    for (const [src, name] of [
      [CONFIG_DB, "config.db"], [CONVERSATIONS_DB, "conversations.db"], [KNOWLEDGE_DB, "knowledge.db"],
    ] as const) {
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(preDir, name));
    }

    closeAllDbs();

    // Copy snapshot databases over the live files.
    for (const [name, dest] of [
      ["config.db", CONFIG_DB], ["conversations.db", CONVERSATIONS_DB], ["knowledge.db", KNOWLEDGE_DB],
    ] as const) {
      const snap = path.join(dir, name);
      if (fs.existsSync(snap)) {
        for (const suffix of ["", "-wal", "-shm"]) {
          try { fs.rmSync(dest + suffix, { force: true }); } catch {}
        }
        fs.copyFileSync(snap, dest);
      }
    }
    logger.warn("backup restored", { snapshot, preRestore: preDir });

    // Restart the app so it reopens the restored databases.
    setTimeout(() => {
      execFile("pm2", ["restart", "localmind"], () => process.exit(0));
    }, 500);

    return NextResponse.json({ ok: true, message: "Restore in progress — the app is restarting." });
  } catch (e: any) {
    return NextResponse.json(
      { status: 500, error: "restore_failed", message: "Restore failed: " + (e?.message || "unknown") },
      { status: 500 }
    );
  }
}
