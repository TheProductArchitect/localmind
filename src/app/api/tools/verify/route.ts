import { NextRequest, NextResponse } from "next/server";
import { runAppleScript } from "@/lib/tools/applescript";

export const runtime = "nodejs";

// Sends a harmless AppleScript probe to check whether macOS automation
// permission has been granted for a tool.
const PROBES: Record<string, { script: string; pane: string }> = {
  calendar: {
    script: 'tell application "Calendar" to get name of calendars',
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
  },
  email: {
    script: 'tell application "Mail" to get name of every account',
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  },
  mac_automation: {
    script: 'tell application "Finder" to get name',
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  },
};

export async function POST(req: NextRequest) {
  const { tool } = await req.json();
  const probe = PROBES[tool];
  if (!probe) {
    return NextResponse.json({ status: 400, error: "bad_request", message: "Unknown tool." }, { status: 400 });
  }
  try {
    await runAppleScript(probe.script, 8000);
    return NextResponse.json({ verified: true });
  } catch (e: any) {
    const msg = String(e?.message || "");
    const denied = /not allowed|permission|-1743|access/i.test(msg);
    return NextResponse.json({
      verified: false,
      reason: denied ? "Permission denied" : "Probe failed",
      detail: msg.slice(0, 200),
      settingsPane: probe.pane,
    });
  }
}
