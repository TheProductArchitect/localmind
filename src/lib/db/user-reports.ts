import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type UserReportStatus = "open" | "reviewed" | "promoted" | "dismissed";

export type UserImprovementReport = {
  id: string;
  route: string;
  note: string;
  context_json: string;
  screenshot_data_url: string | null;
  analysis_json: string | null;
  status: UserReportStatus;
  created_at: number;
};

export type ReportAnalysis = {
  title: string;
  summary: string;
  severity: "low" | "medium" | "high";
  suggestions: string[];
  related_areas: string[];
};

export function createUserReport(o: {
  route: string;
  note?: string;
  context?: Record<string, unknown>;
  screenshot_data_url?: string | null;
  analysis?: ReportAnalysis | null;
}): UserImprovementReport {
  const id = `rpt-${nanoid(10)}`;
  getConfigDb()
    .prepare(
      `INSERT INTO user_improvement_reports
        (id, route, note, context_json, screenshot_data_url, analysis_json, status, created_at)
       VALUES (?,?,?,?,?,?, 'open', ?)`
    )
    .run(
      id,
      o.route || "/",
      o.note ?? "",
      JSON.stringify(o.context ?? {}),
      o.screenshot_data_url ?? null,
      o.analysis ? JSON.stringify(o.analysis) : null,
      Date.now()
    );
  return getUserReport(id)!;
}

export function getUserReport(id: string): UserImprovementReport | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM user_improvement_reports WHERE id=?")
      .get(id) as UserImprovementReport | undefined) || null
  );
}

export function listUserReports(limit = 40): UserImprovementReport[] {
  return getConfigDb()
    .prepare(
      "SELECT * FROM user_improvement_reports ORDER BY created_at DESC LIMIT ?"
    )
    .all(Math.min(Math.max(limit, 1), 200)) as UserImprovementReport[];
}

export function setUserReportStatus(
  id: string,
  status: UserReportStatus
): UserImprovementReport | null {
  getConfigDb()
    .prepare("UPDATE user_improvement_reports SET status=? WHERE id=?")
    .run(status, id);
  return getUserReport(id);
}
