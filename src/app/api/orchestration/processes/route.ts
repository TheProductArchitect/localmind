import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { listActive, listHistory } from "@/lib/db/agent-processes";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;
  const history = req.nextUrl.searchParams.get("history") === "1";
  if (history) {
    return NextResponse.json({ processes: listHistory(scope, 50) });
  }
  return NextResponse.json({ processes: listActive(scope) });
}
