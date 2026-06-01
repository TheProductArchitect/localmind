import { NextResponse } from "next/server";
import { listManagedSpreadsheets } from "@/lib/tools/spreadsheet";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const s = getSettings();
  const approved = (() => {
    try { return JSON.parse(s.approved_dirs || "[]") as string[]; } catch { return []; }
  })();
  const files = await listManagedSpreadsheets(approved);
  return NextResponse.json({ approvedDirs: approved, spreadsheets: files });
}
