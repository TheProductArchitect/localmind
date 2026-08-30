import { NextRequest, NextResponse } from "next/server";
import { createUserReport, listUserReports } from "@/lib/db/user-reports";
import { analyzeImprovementReport } from "@/lib/reports/analyze-improvement";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") || 40);
  const reports = listUserReports(limit).map((r) => ({
    ...r,
    context: safeJson(r.context_json),
    analysis: safeJson(r.analysis_json),
    screenshot_data_url: r.screenshot_data_url ? "[attached]" : null,
  }));
  return NextResponse.json({ reports });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const note = String(body.note || "").trim();
  const route = String(body.route || "/").trim() || "/";
  const clientErrors = Array.isArray(body.clientErrors)
    ? body.clientErrors.map((e: unknown) => String(e)).slice(0, 30)
    : [];
  const userAgent = String(body.userAgent || "").slice(0, 400);
  let screenshot: string | null = null;
  if (typeof body.screenshotDataUrl === "string" && body.screenshotDataUrl.startsWith("data:image/")) {
    // Cap ~1.5MB of base64 to keep the row/request sane
    if (body.screenshotDataUrl.length <= 2_000_000) {
      screenshot = body.screenshotDataUrl;
    }
  }

  if (!note && clientErrors.length === 0) {
    return NextResponse.json(
      { error: "Add a short note describing what felt wrong or what you'd improve." },
      { status: 400 }
    );
  }

  try {
    const { analysis, serverErrors } = await analyzeImprovementReport({
      route,
      note,
      clientErrors,
      userAgent,
      screenshotDataUrl: screenshot,
    });

    const report = createUserReport({
      route,
      note,
      context: {
        clientErrors,
        serverErrors,
        userAgent,
        analyzedAt: Date.now(),
      },
      screenshot_data_url: screenshot,
      analysis,
    });

    logger.info("user_improvement_report", {
      id: report.id,
      route,
      severity: analysis.severity,
      title: analysis.title,
    });

    return NextResponse.json({
      report: {
        id: report.id,
        route: report.route,
        note: report.note,
        status: report.status,
        created_at: report.created_at,
      },
      analysis,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("user_improvement_report_failed", { error: msg, route });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
