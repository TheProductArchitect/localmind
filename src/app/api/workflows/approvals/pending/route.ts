import { NextResponse } from "next/server";
import { listPendingWorkflowApprovals } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ approvals: listPendingWorkflowApprovals() });
}
