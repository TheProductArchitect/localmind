import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getConvDb } from "@/lib/db";
import { getConfigDb } from "@/lib/db";
import {
  getSettings, listConversations, getMessages, listAudit, listMemory, listProfiles,
} from "@/lib/db/queries";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

async function checkPin(pin: unknown): Promise<boolean> {
  const s = getSettings();
  if (!s.pin_hash) return true; // no PIN configured
  if (typeof pin !== "string") return false;
  return bcrypt.compare(pin, s.pin_hash);
}

export async function GET() {
  // Export all data as a JSON bundle.
  const bundle = {
    exported_at: Date.now(),
    settings: getSettings(),
    profiles: listProfiles(),
    memory: listMemory(),
    audit_log: listAudit(100000, 0),
    conversations: listConversations().map((c) => ({ ...c, messages: getMessages(c.id) })),
  };
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="localmind-export.json"',
    },
  });
}

export async function POST(req: NextRequest) {
  const { action, pin, confirm } = await req.json();

  if (action === "delete-conversations") {
    if (!(await checkPin(pin))) return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
    getConvDb().exec("DELETE FROM tool_calls; DELETE FROM messages; DELETE FROM conversations;");
    logger.warn("all conversations deleted");
    return NextResponse.json({ ok: true });
  }

  if (action === "factory-reset") {
    if (!(await checkPin(pin))) return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
    if (confirm !== "RESET") return NextResponse.json({ error: "Type RESET to confirm" }, { status: 400 });
    getConvDb().exec("DELETE FROM tool_calls; DELETE FROM messages; DELETE FROM conversations;");
    getConfigDb().exec("DELETE FROM memory; DELETE FROM api_keys; DELETE FROM mcp_servers;");
    getConfigDb()
      .prepare(
        "UPDATE settings SET assistant_name='Assistant', personality='Friendly', pin_hash=NULL, " +
          "active_model=NULL, approved_dirs='[]', onboarded=0, active_profile_id='normal' WHERE id=1"
      )
      .run();
    logger.warn("factory reset performed");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
