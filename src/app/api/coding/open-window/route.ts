import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/identity";

export const runtime = "nodejs";

/**
 * Ask the Electron shell (if present) to open a focused coding window.
 * Browser clients ignore this and use window.open from the page.
 */
export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  // Signal file for Electron main to pick up (best-effort IPC substitute
  // when renderer cannot invoke ipc directly from Next API).
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { DATA_DIR } = await import("@/lib/paths");
    const signal = path.join(DATA_DIR, "open-coding-window.json");
    fs.writeFileSync(
      signal,
      JSON.stringify({ project_id: projectId, at: Date.now(), path: `/projects?project=${projectId}&focus=1` })
    );
  } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true, href: `/projects?project=${projectId}&focus=1` });
}
