import { NextRequest, NextResponse } from "next/server";
import { ensureBrowseSession, browseNavigate, browseSnapshot } from "@/lib/browse/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pathId } = await params;
  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";
  if (!url.trim()) {
    return NextResponse.json({ error: "url is required." }, { status: 400 });
  }

  try {
    const sessionId = await ensureBrowseSession(pathId === "new" ? null : pathId);
    const result = await browseNavigate(sessionId, url);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, blocked: true, sessionId }, { status: 403 });
    }
    const snap = await browseSnapshot(sessionId);
    return NextResponse.json(snap);
  } catch (e: any) {
    if (e?.code === "SESSION_EXPIRED") {
      return NextResponse.json({ error: e.message, expired: true }, { status: 410 });
    }
    const msg = e?.message || "Browser failed.";
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Chromium not found for Playwright. From the LocalMind folder run: npx playwright install chromium\n\nIf you use Cursor, its sandbox PLAYWRIGHT_BROWSERS_PATH can hide your real install — LocalMind now falls back to ~/Library/Caches/ms-playwright automatically after a dev-server restart.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
