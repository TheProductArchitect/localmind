import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { runIdleCycle } from "@/lib/agent/idle-cycle";

export const runtime = "nodejs";
export const maxDuration = 300;

// Worker-driven idle tick. Returns fast (ran:false) when the system isn't
// idle-eligible, so it's cheap to poll every worker tick.
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await runIdleCycle();
  return NextResponse.json(result);
}
