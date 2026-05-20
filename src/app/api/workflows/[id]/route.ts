import { NextRequest, NextResponse } from "next/server";
import { updateWorkflow, deleteWorkflow, getWorkflow, listWorkflowRuns } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const wf = getWorkflow(params.id);
  if (!wf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    workflow: { ...wf, steps: JSON.parse(wf.steps), trigger_config: JSON.parse(wf.trigger_config) },
    runs: listWorkflowRuns(params.id),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  updateWorkflow(params.id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  deleteWorkflow(params.id);
  return NextResponse.json({ ok: true });
}
