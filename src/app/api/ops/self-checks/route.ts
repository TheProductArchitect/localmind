import { NextRequest, NextResponse } from "next/server";
import { listSelfChecks } from "@/lib/db/self-checks";

export const runtime = "nodejs";

// Queryable idle-cycle check history (e.g. test runs). Read-only; `?limit=` caps
// the page size. Lets the Ops surface and tooling show self-check outcomes
// instead of them being write-only.
export async function GET(req: NextRequest) {
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
  return NextResponse.json({ checks: listSelfChecks(limit) });
}
