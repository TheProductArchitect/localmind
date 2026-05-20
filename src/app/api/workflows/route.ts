import { NextRequest, NextResponse } from "next/server";
import { listWorkflows, createWorkflow } from "@/lib/db/automations";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow/templates";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    workflows: listWorkflows().map((w) => ({ ...w, steps: JSON.parse(w.steps), trigger_config: JSON.parse(w.trigger_config) })),
    templates: WORKFLOW_TEMPLATES,
  });
}

export async function POST(req: NextRequest) {
  const { name, steps, trigger_type, trigger_config, templateId } = await req.json();
  if (templateId) {
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
    return NextResponse.json({
      workflow: createWorkflow({ name: tpl.name, steps: tpl.steps, trigger_type: tpl.trigger_type }),
    });
  }
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  return NextResponse.json({
    workflow: createWorkflow({ name, steps: steps || [], trigger_type, trigger_config }),
  });
}
