import { NextRequest, NextResponse } from "next/server";
import { listAudit } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);
  const offset = Number(sp.get("offset")) || 0;
  const idRaw = sp.get("id");
  const id = idRaw != null && idRaw !== "" ? Number(idRaw) : undefined;
  const rows = listAudit(limit, offset, {
    tool: sp.get("tool") || undefined,
    status: sp.get("status") || undefined,
    q: sp.get("q") || undefined,
    id: id != null && Number.isFinite(id) ? id : undefined,
  });
  return NextResponse.json({ rows });
}
