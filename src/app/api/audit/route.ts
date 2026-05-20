import { NextRequest, NextResponse } from "next/server";
import { listAudit } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);
  const offset = Number(sp.get("offset")) || 0;
  const rows = listAudit(limit, offset, {
    tool: sp.get("tool") || undefined,
    status: sp.get("status") || undefined,
    q: sp.get("q") || undefined,
  });
  return NextResponse.json({ rows });
}
