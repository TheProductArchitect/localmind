import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getProcess, updateProcess } from "@/lib/db/agent-processes";
import { pauseProcess } from "@/lib/agent/process-registry";

export const runtime = "nodejs";

// V5 pause is an advisory flag: the engine sees it between iterations and
// suspends until /resume. For now we set status='paused' so the UI reflects
// intent — full mid-iteration suspension lands when the engine's stream loop
// is refactored to await a "resume" signal in V5.1.
export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const proc = getProcess(params.id);
  const user = currentUser(req);
  if (!proc || !user) return NextResponse.json({ error: "Process not found." }, { status: 404 });
  if (proc.owner_user_id && proc.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Process not found." }, { status: 404 });
  }
  if (proc.completed_at) {
    return NextResponse.json({ error: "Process already completed." }, { status: 400 });
  }
  pauseProcess(params.id);
  updateProcess(params.id, { status: "paused", current_step: "paused by user" });
  return NextResponse.json({ ok: true });
}
