import { nanoid } from "nanoid";
import { getConfigDb } from ".";

// ---- Scheduled tasks ----
export type ScheduledTask = {
  id: string;
  name: string;
  creator_user_id: string | null;
  cron: string;
  prompt: string;
  delivery_channel: string;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
  last_output: string | null;
};

export function listTasks(): ScheduledTask[] {
  return getConfigDb().prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC").all() as ScheduledTask[];
}
export function getTask(id: string): ScheduledTask | null {
  return (getConfigDb().prepare("SELECT * FROM scheduled_tasks WHERE id=?").get(id) as ScheduledTask) || null;
}
export function createTask(o: { name: string; cron: string; prompt: string; delivery_channel?: string; creator?: string }): ScheduledTask {
  const id = nanoid(12);
  getConfigDb()
    .prepare("INSERT INTO scheduled_tasks (id,name,creator_user_id,cron,prompt,delivery_channel,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run(id, o.name, o.creator ?? null, o.cron, o.prompt, o.delivery_channel || "browser", Date.now());
  return getTask(id)!;
}
export function recordTaskRun(id: string, output: string) {
  getConfigDb().prepare("UPDATE scheduled_tasks SET last_run_at=?, last_output=? WHERE id=?")
    .run(Date.now(), output.slice(0, 4000), id);
}
export function setTaskEnabled(id: string, enabled: boolean) {
  getConfigDb().prepare("UPDATE scheduled_tasks SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
}
export function deleteTask(id: string) {
  getConfigDb().prepare("DELETE FROM scheduled_tasks WHERE id=?").run(id);
}

// ---- Monitors ----
export type Monitor = {
  id: string;
  name: string;
  creator_user_id: string | null;
  check_type: string;
  check_config: string;
  frequency_seconds: number;
  last_checked_at: number | null;
  last_status: string | null;
  trigger_workflow_id: string | null;
  enabled: number;
  created_at: number;
};

export function listMonitors(): Monitor[] {
  return getConfigDb().prepare("SELECT * FROM monitors ORDER BY created_at DESC").all() as Monitor[];
}
export function getMonitor(id: string): Monitor | null {
  return (getConfigDb().prepare("SELECT * FROM monitors WHERE id=?").get(id) as Monitor) || null;
}
export function createMonitor(o: {
  name: string; check_type: string; check_config: any; frequency_seconds: number;
  trigger_workflow_id?: string; creator?: string;
}): Monitor {
  const id = nanoid(12);
  getConfigDb()
    .prepare("INSERT INTO monitors (id,name,creator_user_id,check_type,check_config,frequency_seconds,trigger_workflow_id,enabled,created_at) VALUES (?,?,?,?,?,?,?,1,?)")
    .run(id, o.name, o.creator ?? null, o.check_type, JSON.stringify(o.check_config), o.frequency_seconds, o.trigger_workflow_id ?? null, Date.now());
  return getMonitor(id)!;
}
export function recordMonitorCheck(id: string, status: string) {
  getConfigDb().prepare("UPDATE monitors SET last_checked_at=?, last_status=? WHERE id=?")
    .run(Date.now(), status, id);
}
export function deleteMonitor(id: string) {
  getConfigDb().prepare("DELETE FROM monitors WHERE id=?").run(id);
}

// ---- Workflows ----
export type Workflow = {
  id: string;
  name: string;
  creator_user_id: string | null;
  trigger_type: string;
  trigger_config: string;
  steps: string;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
};

export function listWorkflows(): Workflow[] {
  return getConfigDb().prepare("SELECT * FROM workflows ORDER BY created_at DESC").all() as Workflow[];
}
export function getWorkflow(id: string): Workflow | null {
  return (getConfigDb().prepare("SELECT * FROM workflows WHERE id=?").get(id) as Workflow) || null;
}
export function createWorkflow(o: { name: string; trigger_type?: string; trigger_config?: any; steps?: any[]; creator?: string }): Workflow {
  const id = nanoid(12);
  getConfigDb()
    .prepare("INSERT INTO workflows (id,name,creator_user_id,trigger_type,trigger_config,steps,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run(id, o.name, o.creator ?? null, o.trigger_type || "manual", JSON.stringify(o.trigger_config || {}), JSON.stringify(o.steps || []), Date.now());
  return getWorkflow(id)!;
}
export function updateWorkflow(id: string, patch: { name?: string; steps?: any[]; enabled?: boolean; trigger_type?: string; trigger_config?: any }) {
  const p: any = {};
  if (patch.name !== undefined) p.name = patch.name;
  if (patch.steps !== undefined) p.steps = JSON.stringify(patch.steps);
  if (patch.enabled !== undefined) p.enabled = patch.enabled ? 1 : 0;
  if (patch.trigger_type !== undefined) p.trigger_type = patch.trigger_type;
  if (patch.trigger_config !== undefined) p.trigger_config = JSON.stringify(patch.trigger_config);
  const keys = Object.keys(p);
  if (!keys.length) return;
  getConfigDb().prepare(`UPDATE workflows SET ${keys.map((k) => `${k}=@${k}`).join(", ")} WHERE id=@id`).run({ ...p, id });
}
export function deleteWorkflow(id: string) {
  getConfigDb().prepare("DELETE FROM workflows WHERE id=?").run(id);
}
export function markWorkflowRun(id: string) {
  getConfigDb().prepare("UPDATE workflows SET last_run_at=? WHERE id=?").run(Date.now(), id);
}

// ---- Workflow runs ----
export function createWorkflowRun(workflowId: string): string {
  const id = nanoid(14);
  getConfigDb()
    .prepare("INSERT INTO workflow_runs (id,workflow_id,triggered_at,status,step_results) VALUES (?,?,?,'running','[]')")
    .run(id, workflowId, Date.now());
  return id;
}
export function finishWorkflowRun(id: string, status: string, stepResults: any[]) {
  getConfigDb()
    .prepare("UPDATE workflow_runs SET completed_at=?, status=?, step_results=? WHERE id=?")
    .run(Date.now(), status, JSON.stringify(stepResults), id);
}
export function listWorkflowRuns(workflowId: string) {
  return getConfigDb()
    .prepare("SELECT * FROM workflow_runs WHERE workflow_id=? ORDER BY triggered_at DESC LIMIT 20")
    .all(workflowId);
}
