import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { runMonitor } from "@/lib/automations/monitor";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { monitorId } = await req.json();
  const result = await runMonitor(monitorId);
  return NextResponse.json(result);
}
