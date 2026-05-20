import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db/queries";
import { hashToken } from "@/lib/auth/jwt";
import { handleInbound } from "@/lib/channels";
import { runWorkflow } from "@/lib/workflow/executor";
import { listWorkflows } from "@/lib/db/automations";

export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const s = getSettings();
  if (!s.api_token_hash) return false;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!bearer && hashToken(bearer) === s.api_token_hash;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ status: "ok", workflows: listWorkflows().map((w) => ({ id: w.id, name: w.name })) });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.action === "message" && typeof body.message === "string") {
    const reply = await handleInbound("webhook", "api", body.message);
    return NextResponse.json({ reply });
  }
  if (body.action === "run_workflow" && body.workflowId) {
    const result = await runWorkflow(body.workflowId);
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
