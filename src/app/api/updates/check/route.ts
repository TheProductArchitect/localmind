import { NextResponse } from "next/server";

export const runtime = "nodejs";

const REPO = process.env.LOCALMIND_REPO || "localmind/localmind";
const CURRENT = "0.1.0";

export async function GET() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return NextResponse.json({ current: CURRENT, latest: CURRENT, updateAvailable: false });
    }
    const j = (await r.json()) as any;
    const latest = (j.tag_name || CURRENT).replace(/^v/, "");
    return NextResponse.json({
      current: CURRENT,
      latest,
      updateAvailable: latest !== CURRENT,
      changelog: j.body || "",
    });
  } catch {
    return NextResponse.json({
      current: CURRENT,
      latest: CURRENT,
      updateAvailable: false,
      error: "Could not reach GitHub to check for updates.",
    });
  }
}
