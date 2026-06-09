import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getJob, appendInjects } from "@/lib/db/long-running-jobs";

export const runtime = "nodejs";

const Body = z.object({ message: z.string().min(1).max(2000) });

export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const job = getJob(params.id);
  const user = currentUser(req);
  if (!job || !user) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.owner_user_id && job.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ error: "Job is no longer running." }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  appendInjects(params.id, parsed.data.message);
  return NextResponse.json({ ok: true });
}
