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
}): string {
  const id = `proc-${nanoid(12)}`;
  getConfigDb()
    .prepare(
      `INSERT INTO agent_processes
        (process_id, process_type, display_name, owner_user_id, agent_name, persona_id,
         started_at, completed_at, status, current_step, priority, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
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
      JSON.stringify(args.metadata ?? {})
    );
  return id;
}

export function updateProcess(
  processId: string,
  patch: { status?: ProcessStatus; current_step?: string | null; metadata?: Record<string, unknown> }
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: processId };
  if (patch.status !== undefined) { sets.push("status=@status"); params.status = patch.status; }
  if (patch.current_step !== undefined) { sets.push("current_step=@current_step"); params.current_step = patch.current_step; }
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
