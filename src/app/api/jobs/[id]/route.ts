import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getJob, listCheckpoints, updateJobStatus } from "@/lib/db/long-running-jobs";
import { cancelProcess } from "@/lib/agent/process-registry";

export const runtime = "nodejs";

function authorise(req: NextRequest, jobId: string) {
  const job = getJob(jobId);
  const user = currentUser(req);
  if (!job || !user) return { job: null, user };
  if (job.owner_user_id && job.owner_user_id !== user.id && !isOwner(req)) {
    return { job: null, user };
  }
  return { job, user };
}

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { job } = authorise(req, params.id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({
    job,
    checkpoints: listCheckpoints(params.id),
  });
}

export async function DELETE(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { job } = authorise(req, params.id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  updateJobStatus(params.id, "cancelled");
  if (job.process_id) cancelProcess(job.process_id);
  return NextResponse.json({ ok: true });
}
