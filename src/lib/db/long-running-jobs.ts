import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type LongJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type LongJob = {
  job_id: string;
  job_name: string;
  goal: string;
  owner_user_id: string | null;
  allowed_tools: string;          // JSON array
  max_duration_hours: number;
  max_iterations: number;
  stopping_condition: string;     // 'natural' | free-form description
  notification_channel: string | null;
  status: LongJobStatus;
  created_at: number;
  last_checkpoint_at: number | null;
  pending_injects: string;        // JSON array of strings
  conversation_id: string | null;
  current_iteration: number;
  process_id: string | null;
};

export type JobCheckpoint = {
  checkpoint_id: string;
  job_id: string;
  iteration: number;
  conversation_snapshot: string;  // JSON
  status_description: string | null;
  created_at: number;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function createJob(args: {
  job_name: string;
  goal: string;
  owner_user_id?: string | null;
  allowed_tools?: string[];
  max_duration_hours?: number;
  max_iterations?: number;
  stopping_condition?: string;
  notification_channel?: string | null;
}): LongJob {
  const id = `job-${nanoid(12)}`;
  getConfigDb()
    .prepare(
      `INSERT INTO long_running_jobs
        (job_id, job_name, goal, owner_user_id, allowed_tools, max_duration_hours,
         max_iterations, stopping_condition, notification_channel, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      args.job_name.slice(0, 200),
      args.goal,
      args.owner_user_id ?? null,
      JSON.stringify(args.allowed_tools ?? []),
      Math.min(Math.max(args.max_duration_hours ?? 2, 1), 24),
      Math.min(Math.max(args.max_iterations ?? 50, 1), 500),
      args.stopping_condition ?? "natural",
      args.notification_channel ?? null,
      "pending",
      readNow()
    );
  return getJob(id)!;
}

export function getJob(jobId: string): LongJob | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM long_running_jobs WHERE job_id=?")
      .get(jobId) as LongJob | undefined) || null
  );
}

export function listJobs(ownerUserId?: string | null): LongJob[] {
  if (ownerUserId) {
    return getConfigDb()
      .prepare(
        "SELECT * FROM long_running_jobs WHERE owner_user_id IS NULL OR owner_user_id=? ORDER BY created_at DESC"
      )
      .all(ownerUserId) as LongJob[];
  }
  return getConfigDb()
    .prepare("SELECT * FROM long_running_jobs ORDER BY created_at DESC")
    .all() as LongJob[];
}

export function updateJobStatus(jobId: string, status: LongJobStatus): void {
  getConfigDb()
    .prepare("UPDATE long_running_jobs SET status=? WHERE job_id=?")
    .run(status, jobId);
}

export function setJobConversation(jobId: string, conversationId: string): void {
  getConfigDb()
    .prepare("UPDATE long_running_jobs SET conversation_id=? WHERE job_id=?")
    .run(conversationId, jobId);
}

export function setJobProcess(jobId: string, processId: string): void {
  getConfigDb()
    .prepare("UPDATE long_running_jobs SET process_id=? WHERE job_id=?")
    .run(processId, jobId);
}

export function appendInjects(jobId: string, message: string): void {
  const job = getJob(jobId);
  if (!job) return;
  const arr = safeParseArr(job.pending_injects);
  arr.push(message);
  getConfigDb()
    .prepare("UPDATE long_running_jobs SET pending_injects=? WHERE job_id=?")
    .run(JSON.stringify(arr), jobId);
}

/** Drains pending injects atomically — returns the messages and clears them. */
export function drainInjects(jobId: string): string[] {
  const db = getConfigDb();
  const tx = db.transaction(() => {
    const cur = db.prepare("SELECT pending_injects FROM long_running_jobs WHERE job_id=?").get(jobId) as
      | { pending_injects: string }
      | undefined;
    if (!cur) return [];
    db.prepare("UPDATE long_running_jobs SET pending_injects='[]' WHERE job_id=?").run(jobId);
    return safeParseArr(cur.pending_injects);
  });
  return tx();
}

export function writeCheckpoint(args: {
  job_id: string;
  iteration: number;
  conversation_snapshot: unknown;
  status_description?: string | null;
}): JobCheckpoint {
  const id = `chk-${nanoid(12)}`;
  const now = readNow();
  getConfigDb()
    .prepare(
      `INSERT INTO job_checkpoints
        (checkpoint_id, job_id, iteration, conversation_snapshot, status_description, created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(
      id,
      args.job_id,
      args.iteration,
      JSON.stringify(args.conversation_snapshot),
      args.status_description ?? null,
      now
    );
  getConfigDb()
    .prepare("UPDATE long_running_jobs SET current_iteration=?, last_checkpoint_at=? WHERE job_id=?")
    .run(args.iteration, now, args.job_id);
  return {
    checkpoint_id: id,
    job_id: args.job_id,
    iteration: args.iteration,
    conversation_snapshot: JSON.stringify(args.conversation_snapshot),
    status_description: args.status_description ?? null,
    created_at: now,
  };
}

export function latestCheckpoint(jobId: string): JobCheckpoint | null {
  return (
    (getConfigDb()
      .prepare(
        "SELECT * FROM job_checkpoints WHERE job_id=? ORDER BY iteration DESC LIMIT 1"
      )
      .get(jobId) as JobCheckpoint | undefined) || null
  );
}

export function listCheckpoints(jobId: string, limit = 50): JobCheckpoint[] {
  return getConfigDb()
    .prepare(
      "SELECT * FROM job_checkpoints WHERE job_id=? ORDER BY iteration DESC LIMIT ?"
    )
    .all(jobId, limit) as JobCheckpoint[];
}

/** Returns jobs that the boot-time resumer should pick up. */
export function listResumable(): LongJob[] {
  return getConfigDb()
    .prepare("SELECT * FROM long_running_jobs WHERE status IN ('running','paused')")
    .all() as LongJob[];
}

function safeParseArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
