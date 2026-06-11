import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getProcess } from "@/lib/db/agent-processes";
import { buildTrace } from "@/lib/agent/trace";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const proc = getProcess(params.id);
  const user = currentUser(req);
  if (!proc || !user) return NextResponse.json({ error: "Process not found." }, { status: 404 });
  if (proc.owner_user_id && proc.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Process not found." }, { status: 404 });
  }
  return NextResponse.json({ process: proc, events: buildTrace(params.id) });
}
