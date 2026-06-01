import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { createJob, listJobs } from "@/lib/db/long-running-jobs";
import { enqueueJob } from "@/lib/db/jobs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;
  return NextResponse.json({ jobs: listJobs(scope) });
}

const CreateBody = z.object({
  job_name: z.string().min(1).max(200),
  goal: z.string().min(1).max(4000),
  allowed_tools: z.array(z.string()).optional(),
  max_duration_hours: z.number().int().min(1).max(24).optional(),
  max_iterations: z.number().int().min(1).max(500).optional(),
  stopping_condition: z.string().max(200).optional(),
  notification_channel: z.string().max(80).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job payload." }, { status: 400 });
  }

  const job = createJob({ ...parsed.data, owner_user_id: user.id });
  // Hand off to the worker via the existing `jobs` queue. The next worker tick
  // (within a few seconds) picks it up and runs the executor.
  enqueueJob("long_running_job", { jobId: job.job_id });
  return NextResponse.json({ job });
}
