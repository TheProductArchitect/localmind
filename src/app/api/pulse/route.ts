/**
 * GET /api/pulse — system-wide activity heartbeat.
 *
 * The Rail orb polls this lightweight endpoint to mirror what Sora is
 * doing across the whole product, not just the open chat. The response
 * collapses every active process, running task graph, and loop-guard
 * suspension into a single visual state that the orb can render.
 *
 * Polled every ~4s by the Rail. Designed to be cheap: two indexed
 * SELECTs against conv.db, nothing more.
 *
 * Response:
 *   {
 *     state: "idle" | "thinking" | "tool" | "spawn" | "suspended",
 *     processes: number,         // count of active processes
 *     graphs: number,             // count of running graphs
 *     subagents: number,          // approximated subagent breadth (for orb satellites)
 *     suspended: boolean          // any conversation paused by loop-guard?
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { listActive } from "@/lib/db/agent-processes";
import { listGraphs } from "@/lib/db/task-graphs";
import { getConvDb } from "@/lib/db";

export const runtime = "nodejs";

function anySuspended(): boolean {
  try {
    const db = getConvDb();
    // The conversation_loop_state table is created lazily by the loop-guard;
    // a missing table is the normal early state and means "nothing suspended".
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_loop_state'")
      .get() as { name?: string } | undefined;
    if (!row?.name) return false;
    const c = db
      .prepare("SELECT COUNT(*) AS n FROM conversation_loop_state WHERE suspended_at IS NOT NULL")
      .get() as { n: number } | undefined;
    return (c?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;

  const activeProcesses = listActive(scope);
  const allGraphs = listGraphs(scope, 100);
  const runningGraphs = allGraphs.filter((g) => g.status === "running" || g.status === "pending");

  // Subagents are processes whose type indicates a spawned child. We
  // approximate the satellite count for the orb by the number of running
  // subagent-shaped processes (capped at 6 to match Orb's render cap).
  const spawnedNow = activeProcesses.filter(
    (p) => (p.display_name || "").toLowerCase().includes("subagent")
  ).length;

  const suspended = anySuspended();

  let state: "idle" | "thinking" | "tool" | "spawn" | "suspended" = "idle";
  if (suspended) state = "suspended";
  else if (spawnedNow > 0) state = "spawn";
  else if (activeProcesses.length > 0 || runningGraphs.length > 0) state = "thinking";

  return NextResponse.json({
    state,
    processes: activeProcesses.length,
    graphs: runningGraphs.length,
    subagents: spawnedNow,
    suspended,
  });
}
