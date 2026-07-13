import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type ProcessType =
  | "chat"
  | "workflow"
  | "scheduled_task"
  | "monitor_check"
  | "long_running_job";

export type ProcessStatus =
  | "running"
  | "waiting_confirmation"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "pending";

// The five capability pillars (§6) plus `maintain` for idle/self-upkeep work.
export const PILLARS = ["ideate", "research", "execute", "coordinate", "communicate", "maintain"] as const;
export type Pillar = (typeof PILLARS)[number];

export type AgentProcess = {
  process_id: string;
  process_type: ProcessType;
  display_name: string;
  owner_user_id: string | null;
  agent_name: string | null;
  persona_id: string | null;
  started_at: number;
  completed_at: number | null;
  status: ProcessStatus;
  current_step: string | null;
  priority: number;
  metadata_json: string;
  pillar: Pillar | null;
  parent_process_id: string | null;
  progress: number | null;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function startProcess(args: {
  process_type: ProcessType;
  display_name: string;
  owner_user_id?: string | null;
  agent_name?: string | null;
  persona_id?: string | null;
  metadata?: Record<string, unknown>;
  pillar?: Pillar | null;
  parent_process_id?: string | null;
  progress?: number | null;
}): string {
  const id = `proc-${nanoid(12)}`;
  getConfigDb()
    .prepare(
      `INSERT INTO agent_processes
        (process_id, process_type, display_name, owner_user_id, agent_name, persona_id,
         started_at, completed_at, status, current_step, priority, metadata_json,
         pillar, parent_process_id, progress)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      args.process_type,
      args.display_name.slice(0, 200),
      args.owner_user_id ?? null,
      args.agent_name ?? null,
      args.persona_id ?? null,
      readNow(),
      null,
      "running",
      "starting…",
      0,
      JSON.stringify(args.metadata ?? {}),
      args.pillar ?? null,
      args.parent_process_id ?? null,
      args.progress ?? null
    );
  return id;
}

export function updateProcess(
  processId: string,
  patch: {
    status?: ProcessStatus;
    current_step?: string | null;
    metadata?: Record<string, unknown>;
    pillar?: Pillar | null;
    progress?: number | null;
  }
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: processId };
  if (patch.status !== undefined) { sets.push("status=@status"); params.status = patch.status; }
  if (patch.current_step !== undefined) { sets.push("current_step=@current_step"); params.current_step = patch.current_step; }
  if (patch.pillar !== undefined) { sets.push("pillar=@pillar"); params.pillar = patch.pillar; }
  if (patch.progress !== undefined) { sets.push("progress=@progress"); params.progress = patch.progress; }
  if (patch.metadata !== undefined) {
    // Merge with existing metadata so callers can patch one key without losing others.
    const cur = getConfigDb()
      .prepare("SELECT metadata_json FROM agent_processes WHERE process_id=?")
      .get(processId) as { metadata_json: string } | undefined;
    const merged = { ...(cur ? safeParse(cur.metadata_json) : {}), ...patch.metadata };
    sets.push("metadata_json=@metadata_json");
    params.metadata_json = JSON.stringify(merged);
  }
  if (sets.length === 0) return;
  getConfigDb()
    .prepare(`UPDATE agent_processes SET ${sets.join(", ")} WHERE process_id=@id`)
    .run(params);
}

export function completeProcess(processId: string, status: "completed" | "failed" | "cancelled"): void {
  getConfigDb()
    .prepare("UPDATE agent_processes SET status=?, completed_at=?, current_step=NULL WHERE process_id=?")
    .run(status, readNow(), processId);
}

export function getProcess(processId: string): AgentProcess | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM agent_processes WHERE process_id=?")
      .get(processId) as AgentProcess | undefined) || null
  );
}

export function listActive(ownerUserId?: string | null): AgentProcess[] {
  if (ownerUserId) {
    return getConfigDb()
      .prepare(
        "SELECT * FROM agent_processes WHERE completed_at IS NULL AND (owner_user_id IS NULL OR owner_user_id=?) ORDER BY started_at DESC"
      )
      .all(ownerUserId) as AgentProcess[];
  }
  return getConfigDb()
    .prepare("SELECT * FROM agent_processes WHERE completed_at IS NULL ORDER BY started_at DESC")
    .all() as AgentProcess[];
}

export function listHistory(ownerUserId?: string | null, limit = 50): AgentProcess[] {
  if (ownerUserId) {
    return getConfigDb()
      .prepare(
        "SELECT * FROM agent_processes WHERE completed_at IS NOT NULL AND (owner_user_id IS NULL OR owner_user_id=?) ORDER BY completed_at DESC LIMIT ?"
      )
      .all(ownerUserId, limit) as AgentProcess[];
  }
  return getConfigDb()
    .prepare(
      "SELECT * FROM agent_processes WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT ?"
    )
    .all(limit) as AgentProcess[];
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type BoardLane = "proposals" | "queued" | "running" | "needs_you" | "done" | "failed";
export type Board = {
  lanes: Record<BoardLane, AgentProcess[]>;
  counts: Record<BoardLane, number>;
};

/** Processes completed within the given window (default 24h), for the board's
 *  Done/Failed lanes. */
function listRecentlyCompleted(ownerUserId: string | null | undefined, windowMs = 24 * 60 * 60 * 1000): AgentProcess[] {
  const cutoff = readNow() - windowMs;
  if (ownerUserId) {
    return getConfigDb()
      .prepare(
        "SELECT * FROM agent_processes WHERE completed_at IS NOT NULL AND completed_at >= ? AND (owner_user_id IS NULL OR owner_user_id=?) ORDER BY completed_at DESC"
      )
      .all(cutoff, ownerUserId) as AgentProcess[];
  }
  return getConfigDb()
    .prepare(
      "SELECT * FROM agent_processes WHERE completed_at IS NOT NULL AND completed_at >= ? ORDER BY completed_at DESC"
    )
    .all(cutoff) as AgentProcess[];
}

// The Ops board is a *task* board, not a chat log. Ordinary chat turns complete
// within the chat window and are tracked in /orchestration — they do not belong
// on the board. Only work that runs outside the chat window or can't finish
// within it does: scheduled tasks, monitors, long-running jobs, workflows,
// subagents (registered as long_running_job), and self-improvement proposals.
export function isBoardTask(p: AgentProcess): boolean {
  return p.process_type !== "chat";
}

/** Sort a flat list of processes into Kanban lanes by status. Pure — takes the
 *  rows so it stays trivially testable. Chat turns are filtered out (see
 *  isBoardTask). `needsYouExtra` folds in non-process approvals (e.g. pending
 *  workflow approvals) that also block the user. */
export function bucketLanes(
  active: AgentProcess[],
  recent: AgentProcess[],
  needsYouExtra: AgentProcess[] = [],
  proposalsExtra: AgentProcess[] = []
): Board {
  const lanes: Record<BoardLane, AgentProcess[]> = {
    proposals: [...proposalsExtra],
    queued: [],
    running: [],
    needs_you: [...needsYouExtra],
    done: [],
    failed: [],
  };
  for (const p of active) {
    if (!isBoardTask(p)) continue;
    if (p.status === "pending") lanes.queued.push(p);
    else if (p.status === "running") lanes.running.push(p);
    else if (p.status === "waiting_confirmation" || p.status === "paused") lanes.needs_you.push(p);
  }
  for (const p of recent) {
    if (!isBoardTask(p)) continue;
    if (p.status === "completed") lanes.done.push(p);
    else if (p.status === "failed" || p.status === "cancelled") lanes.failed.push(p);
  }
  const counts = Object.fromEntries(
    (Object.keys(lanes) as BoardLane[]).map((k) => [k, lanes[k].length])
  ) as Record<BoardLane, number>;
  return { lanes, counts };
}

/** One-fetch board aggregation: active + recently-completed processes bucketed
 *  into lanes. Callers pass extra "needs you" and "proposals" cards to fold in. */
export function getBoard(
  ownerUserId?: string | null,
  needsYouExtra: AgentProcess[] = [],
  proposalsExtra: AgentProcess[] = []
): Board {
  return bucketLanes(listActive(ownerUserId), listRecentlyCompleted(ownerUserId), needsYouExtra, proposalsExtra);
}

/** Mark any process whose started_at is older than ms as failed — used when the
 *  app restarts to clean up zombies from crashed runs. */
export function reaper(maxAgeMs = 6 * 60 * 60 * 1000): number {
  const cutoff = readNow() - maxAgeMs;
  const r = getConfigDb()
    .prepare(
      "UPDATE agent_processes SET status='failed', completed_at=?, current_step='abandoned at restart' WHERE completed_at IS NULL AND started_at < ?"
    )
    .run(readNow(), cutoff);
  return r.changes;
}
