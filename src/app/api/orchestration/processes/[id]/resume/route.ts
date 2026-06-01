import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getProcess, updateProcess } from "@/lib/db/agent-processes";
import { resumeProcess } from "@/lib/agent/process-registry";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const proc = getProcess(params.id);
  const user = currentUser(req);
  if (!proc || !user) return NextResponse.json({ error: "Process not found." }, { status: 404 });
  if (proc.owner_user_id && proc.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Process not found." }, { status: 404 });
  }
  if (proc.completed_at) {
    return NextResponse.json({ error: "Process already completed." }, { status: 400 });
  }
  resumeProcess(params.id);
  updateProcess(params.id, { status: "running", current_step: "resumed" });
  return NextResponse.json({ ok: true });
}
