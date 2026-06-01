import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getProcess, completeProcess } from "@/lib/db/agent-processes";
import { cancelProcess } from "@/lib/agent/process-registry";

export const runtime = "nodejs";

function authorise(req: NextRequest, processId: string) {
  const proc = getProcess(processId);
  const user = currentUser(req);
  if (!proc || !user) return { proc: null, user };
  if (proc.owner_user_id && proc.owner_user_id !== user.id && !isOwner(req)) {
    return { proc: null, user };
  }
  return { proc, user };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { proc } = authorise(req, params.id);
  if (!proc) return NextResponse.json({ error: "Process not found." }, { status: 404 });
  return NextResponse.json({ process: proc });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { proc } = authorise(req, params.id);
  if (!proc) return NextResponse.json({ error: "Process not found." }, { status: 404 });
  if (proc.completed_at) {
    return NextResponse.json({ ok: true, alreadyCompleted: true });
  }
  // Signal the in-memory agent loop, then mark cancelled in the DB. The agent's
  // `finally` block will also fire its own completeProcess — last-write wins
  // and since we set the same status, the result is idempotent.
  cancelProcess(params.id);
  completeProcess(params.id, "cancelled");
  return NextResponse.json({ ok: true });
}
