import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type Job = {
  id: string;
  type: string;
  payload: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  total: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
};

export function enqueueJob(type: string, payload: Record<string, any>): string {
  const id = nanoid(14);
  getConfigDb()
    .prepare("INSERT INTO jobs (id,type,payload,status,created_at) VALUES (?,?,?,'pending',?)")
    .run(id, type, JSON.stringify(payload), Date.now());
  return id;
}

export function claimNextJob(type?: string): Job | null {
  const db = getConfigDb();
  const sql = type
    ? "SELECT * FROM jobs WHERE status='pending' AND type=? ORDER BY created_at LIMIT 1"
    : "SELECT * FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1";
  const job = (type ? db.prepare(sql).get(type) : db.prepare(sql).get()) as Job | undefined;
  if (!job) return null;
  db.prepare("UPDATE jobs SET status='running', started_at=? WHERE id=?").run(Date.now(), job.id);
  return { ...job, status: "running" };
}

export function updateJobProgress(id: string, progress: number, total: number) {
  getConfigDb().prepare("UPDATE jobs SET progress=?, total=? WHERE id=?").run(progress, total, id);
}

export function finishJob(id: string, status: "done" | "failed", error?: string) {
  getConfigDb()
    .prepare("UPDATE jobs SET status=?, finished_at=?, error=? WHERE id=?")
    .run(status, Date.now(), error ?? null, id);
}

export function getJob(id: string): Job | null {
  return (getConfigDb().prepare("SELECT * FROM jobs WHERE id=?").get(id) as Job) || null;
}

export function logSecurityEvent(kind: string, detail: string, userId?: string) {
  getConfigDb()
    .prepare("INSERT INTO security_events (timestamp,kind,detail,user_id) VALUES (?,?,?,?)")
    .run(Date.now(), kind, detail, userId ?? null);
}
