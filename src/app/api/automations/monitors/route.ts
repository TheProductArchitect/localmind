import { NextRequest, NextResponse } from "next/server";
import { listMonitors, createMonitor } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    monitors: listMonitors().map((m) => ({ ...m, check_config: JSON.parse(m.check_config || "{}") })),
  });
}

export async function POST(req: NextRequest) {
  const { name, check_type, check_config, frequency_seconds, trigger_workflow_id } = await req.json();
  if (!name || !check_type) {
    return NextResponse.json({ error: "name and check_type required" }, { status: 400 });
  }
  const monitor = createMonitor({
    name,
    check_type,
    check_config: check_config || {},
    frequency_seconds: frequency_seconds || 3600,
    trigger_workflow_id,
  });
  return NextResponse.json({ monitor });
}
