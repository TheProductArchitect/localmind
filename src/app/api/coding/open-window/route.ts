import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/identity";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * Ask the Electron shell (if present) to open a focused coding window.
 * Browser clients ignore this and use window.open from the page.
 *
 * When code_server_enabled is on, the signal includes code_server_url so
 * Electron can load the IDE embed instead of /projects (which remains fallback).
 */
export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  const settings = getSettings();
  const codeServerOn = !!settings.code_server_enabled;
  const codeServerUrl = (settings.code_server_url || "http://127.0.0.1:8080").replace(/\/$/, "");
  const projectsPath = `/projects?project=${projectId}&focus=1`;

  try {
    const fs = await import("fs");
    const path = await import("path");
    const { DATA_DIR } = await import("@/lib/paths");
    const signal = path.join(DATA_DIR, "open-coding-window.json");
    const payload: Record<string, unknown> = {
      project_id: projectId,
      at: Date.now(),
      // Always keep /projects as the relative fallback path.
      path: projectsPath,
    };
    if (codeServerOn && codeServerUrl) {
      payload.code_server_enabled = 1;
      payload.code_server_url = codeServerUrl;
    }
    fs.writeFileSync(signal, JSON.stringify(payload));
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    href: projectsPath,
    code_server_enabled: codeServerOn,
    code_server_url: codeServerOn ? codeServerUrl : null,
  });
}
