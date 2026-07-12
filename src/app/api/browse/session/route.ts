import { NextRequest, NextResponse } from "next/server";
import { ensureBrowseSession, browseSnapshot } from "@/lib/browse/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create or validate a session; returns snapshot of blank page. */
export async function POST(req: NextRequest) {
  try {
    const { sessionId: raw } = await req.json().catch(() => ({}));
    const sessionId = await ensureBrowseSession(typeof raw === "string" ? raw : null);
    const snap = await browseSnapshot(sessionId);
    return NextResponse.json(snap ?? { sessionId, url: "about:blank", title: "", screenshotBase64: "", text: "", viewport: { width: 1280, height: 800 } });
  } catch (e: any) {
    const msg = e?.message || "Could not start browser.";
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      return NextResponse.json(
        { error: "Chromium is not installed. From the LocalMind folder run: npx playwright install chromium" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
