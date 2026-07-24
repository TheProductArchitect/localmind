import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db/queries";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

export async function GET() {
  const s = getSettings();
  const { pin_hash, ...rest } = s;
  return NextResponse.json({ settings: { ...rest, pin_set: !!pin_hash } });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const patch: any = {};
  // Keys the UI is allowed to write. Omitting a field silently drops it —
  // agent_mode / idle_* / web_search_provider were previously missing, which
  // made the mode toggle and idle/search-provider settings appear to save but
  // never persist.
  const allowed = [
    "assistant_name", "personality", "theme", "locale", "active_profile_id",
    "provider", "active_model", "lan_enabled", "port", "https_enabled",
    "approved_dirs", "onboarded", "chat_font_size", "auto_backup", "backup_dir",
    "context_window", "web_access_killed", "agent_mode",
    "web_search_provider", "idle_work_enabled", "idle_start_hour", "idle_end_hour",
    "compute_placement", "workspace_placement",
  ];
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  if (typeof body.pin === "string" && body.pin.length >= 4) {
    patch.pin_hash = await bcrypt.hash(body.pin, 12);
  }
  if (body.pin === null) patch.pin_hash = null;
  if (Array.isArray(body.approved_dirs)) patch.approved_dirs = JSON.stringify(body.approved_dirs);
  updateSettings(patch);
  return NextResponse.json({ ok: true });
}
