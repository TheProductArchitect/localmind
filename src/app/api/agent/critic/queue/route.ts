/**
 * GET /api/agent/critic/queue?status=pending|reviewing|done|failed|skipped
 *
 * Read-only view of the critic queue. The /agents page surfaces this so a user
 * can see which subagent runs the watchdog flagged and what it proposed.
 */

import { NextRequest, NextResponse } from "next/server";
import { listQueue, type CriticQueueStatus } from "@/lib/agent/critic";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = (req.nextUrl.searchParams.get("status") as CriticQueueStatus | null) ?? undefined;
  const items = listQueue({ status });
  return NextResponse.json({ items });
}
