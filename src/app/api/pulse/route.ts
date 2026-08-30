/**
 * GET /api/pulse — system-wide activity heartbeat.
 *
 * The Rail orb polls this lightweight endpoint to mirror what Sora is
 * doing across the whole product, not just the open chat. The response
 * collapses every active process, running task graph, and loop-guard
 * suspension into a single visual state that the orb can render.
 *
 * Polled every ~4s by the Rail, from every open window. Because better-sqlite3
 * is synchronous, anything expensive here stalls the chat stream on the same
 * event loop — so this route only ever runs COUNT queries, and caches the
 * result per scope for a fraction of the poll interval.
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { countActive } from "@/lib/db/agent-processes";
import { countRunningGraphs } from "@/lib/db/task-graphs";
import { getConvDb } from "@/lib/db";

export const runtime = "nodejs";

const TTL_MS = 1_500;

type Pulse = {
  state: "idle" | "thinking" | "tool" | "spawn" | "suspended";
  processes: number;
  graphs: number;
  subagents: number;
  suspended: boolean;
};

const cache = new Map<string, { at: number; value: Pulse }>();

// Whether the loop-guard table exists is fixed for the process lifetime once
// created, so the sqlite_master probe does not need to repeat on every poll.
let loopTablePresent: boolean | null = null;

function anySuspended(): boolean {
  try {
    const db = getConvDb();
    // The conversation_loop_state table is created lazily by the loop-guard;
    // a missing table is the normal early state and means "nothing suspended".
    if (loopTablePresent !== true) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_loop_state'")
        .get() as { name?: string } | undefined;
      loopTablePresent = !!row?.name;
      if (!loopTablePresent) return false;
    }
    const c = db
      .prepare("SELECT COUNT(*) AS n FROM conversation_loop_state WHERE suspended_at IS NOT NULL")
      .get() as { n: number } | undefined;
    return (c?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

function collect(scope: string | null): Pulse {
  const processes = countActive(scope);
  const graphs = countRunningGraphs(scope);
  const suspended = anySuspended();

  let state: Pulse["state"] = "idle";
  if (suspended) state = "suspended";
  else if (processes.subagents > 0) state = "spawn";
  else if (processes.total > 0 || graphs > 0) state = "thinking";

  return {
    state,
    processes: processes.total,
    graphs,
    subagents: processes.subagents,
    suspended,
  };
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;

  const key = scope ?? "*";
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return NextResponse.json(hit.value);

  const value = collect(scope);
  cache.set(key, { at: now, value });
  return NextResponse.json(value);
}
