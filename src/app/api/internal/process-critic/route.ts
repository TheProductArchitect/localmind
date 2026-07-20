import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { runCriticOnce } from "@/lib/agent/critic";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await runCriticOnce();
  return NextResponse.json(result);
}
