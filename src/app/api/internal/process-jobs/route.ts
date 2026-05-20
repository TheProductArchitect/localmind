import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { claimNextJob, finishJob, updateJobProgress } from "@/lib/db/jobs";
import { processIngestJob } from "@/lib/knowledge/ingest";

export const runtime = "nodejs";
export const maxDuration = 600;

// Processes one pending job per call. The worker calls this every few seconds.
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ status: 403, error: "forbidden", message: "Internal only." }, { status: 403 });
  }
  const job = claimNextJob();
  if (!job) return NextResponse.json({ idle: true });

  try {
    if (job.type === "ingest") {
      const payload = JSON.parse(job.payload);
      const result = await processIngestJob(payload, (done, total) => updateJobProgress(job.id, done, total));
      finishJob(job.id, "done");
      return NextResponse.json({ job: job.id, type: job.type, result });
    }
    finishJob(job.id, "failed", `Unknown job type: ${job.type}`);
    return NextResponse.json({ job: job.id, error: "unknown type" });
  } catch (e: any) {
    finishJob(job.id, "failed", e?.message || "job failed");
    return NextResponse.json({ job: job.id, error: e?.message }, { status: 200 });
  }
}
