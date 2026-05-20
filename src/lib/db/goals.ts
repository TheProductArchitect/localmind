import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type Goal = {
  id: string;
  user_id: string | null;
  description: string;
  target_date: string | null;
  milestones: string;
  progress_notes: string;
  progress: number;
  status: string;
  created_at: number;
};

export function listGoals(): Goal[] {
  return getConfigDb().prepare("SELECT * FROM goals ORDER BY created_at DESC").all() as Goal[];
}

export function getGoal(id: string): Goal | null {
  return (getConfigDb().prepare("SELECT * FROM goals WHERE id=?").get(id) as Goal) || null;
}

export function createGoal(o: { description: string; target_date?: string; milestones?: string[]; user_id?: string }): Goal {
  const id = nanoid(12);
  getConfigDb()
    .prepare("INSERT INTO goals (id,user_id,description,target_date,milestones,progress_notes,progress,status,created_at) VALUES (?,?,?,?,?,'[]',0,'active',?)")
    .run(id, o.user_id ?? null, o.description, o.target_date ?? null, JSON.stringify(o.milestones || []), Date.now());
  return getGoal(id)!;
}

export function updateGoal(id: string, patch: { progress?: number; status?: string; note?: string }) {
  const goal = getGoal(id);
  if (!goal) return;
  const p: any = {};
  if (patch.progress !== undefined) p.progress = patch.progress;
  if (patch.status !== undefined) p.status = patch.status;
  if (patch.note) {
    const notes = JSON.parse(goal.progress_notes || "[]");
    notes.push({ at: Date.now(), note: patch.note });
    p.progress_notes = JSON.stringify(notes);
  }
  const keys = Object.keys(p);
  if (!keys.length) return;
  getConfigDb().prepare(`UPDATE goals SET ${keys.map((k) => `${k}=@${k}`).join(", ")} WHERE id=@id`).run({ ...p, id });
}

export function deleteGoal(id: string) {
  getConfigDb().prepare("DELETE FROM goals WHERE id=?").run(id);
}
