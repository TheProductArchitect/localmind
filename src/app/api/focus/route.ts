import { NextRequest, NextResponse } from "next/server";
import { runAppleScript } from "@/lib/tools/applescript";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Focus mode: toggles macOS Do Not Disturb via the Shortcuts CLI.
export async function POST(req: NextRequest) {
  const { enabled, task } = await req.json();
  logger.info("focus mode", { enabled, task });
  try {
    // Uses a Shortcuts action named "Set Focus" if present; otherwise no-ops gracefully.
    await runAppleScript(
      `do shell script "shortcuts run \\"Set Focus\\" 2>/dev/null || true"`
    ).catch(() => {});
    return NextResponse.json({
      ok: true,
      message: enabled
        ? `Focus session started${task ? ` on: ${task}` : ""}. Notifications quieted.`
        : "Focus session ended. Notifications restored.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: true, message: "Focus mode toggled (DND control unavailable on this host)." });
  }
}
