import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type Codebase = {
  id: string;
  name: string;
  path: string;
  last_indexed_at: number | null;
  file_count: number;
  commands: string;
  created_at: number;
};

export type CodebaseFile = {
  id: string;
  codebase_id: string;
  rel_path: string;
  language: string | null;
  summary: string | null;
  symbols: string | null;
  updated_at: number;
};

export function listCodebases(): Codebase[] {
  return getConfigDb().prepare("SELECT * FROM codebases ORDER BY created_at").all() as Codebase[];
}
export function getCodebase(id: string): Codebase | null {
  return (getConfigDb().prepare("SELECT * FROM codebases WHERE id=?").get(id) as Codebase) || null;
}
export function createCodebase(name: string, path: string): Codebase {
  const id = nanoid(10);
  getConfigDb()
    .prepare("INSERT INTO codebases (id,name,path,file_count,commands,created_at) VALUES (?,?,?,0,'[]',?)")
    .run(id, name, path, Date.now());
  return getCodebase(id)!;
}
export function deleteCodebase(id: string) {
  const db = getConfigDb();
  db.prepare("DELETE FROM codebase_files WHERE codebase_id=?").run(id);
  db.prepare("DELETE FROM codebases WHERE id=?").run(id);
}
export function setCodebaseCommands(id: string, commands: { name: string; command: string }[]) {
  getConfigDb().prepare("UPDATE codebases SET commands=? WHERE id=?").run(JSON.stringify(commands), id);
}

export function replaceCodebaseFiles(codebaseId: string, files: Omit<CodebaseFile, "id" | "codebase_id" | "updated_at">[]) {
  const db = getConfigDb();
  db.prepare("DELETE FROM codebase_files WHERE codebase_id=?").run(codebaseId);
  const ins = db.prepare(
    "INSERT INTO codebase_files (id,codebase_id,rel_path,language,summary,symbols,updated_at) VALUES (?,?,?,?,?,?,?)"
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const f of files) ins.run(nanoid(12), codebaseId, f.rel_path, f.language, f.summary, f.symbols, now);
  });
  tx();
  db.prepare("UPDATE codebases SET last_indexed_at=?, file_count=? WHERE id=?").run(now, files.length, codebaseId);
}

export function listCodebaseFiles(codebaseId: string): CodebaseFile[] {
  return getConfigDb()
    .prepare("SELECT * FROM codebase_files WHERE codebase_id=?")
    .all(codebaseId) as CodebaseFile[];
}

export function searchCodebaseFiles(codebaseId: string, query: string): CodebaseFile[] {
  const q = `%${query}%`;
  return getConfigDb()
    .prepare("SELECT * FROM codebase_files WHERE codebase_id=? AND (rel_path LIKE ? OR symbols LIKE ? OR summary LIKE ?) LIMIT 20")
    .all(codebaseId, q, q, q) as CodebaseFile[];
}

// ---- local dev tasks ----
export type DevTask = { id: string; title: string; status: string; priority: string; notes: string | null; created_at: number };
export function listDevTasks(): DevTask[] {
  return getConfigDb().prepare("SELECT * FROM dev_tasks ORDER BY created_at DESC").all() as DevTask[];
}
export function createDevTask(title: string, priority = "normal"): DevTask {
  const id = nanoid(10);
  getConfigDb()
    .prepare("INSERT INTO dev_tasks (id,title,status,priority,created_at) VALUES (?,?,'open',?,?)")
    .run(id, title, priority, Date.now());
  return getConfigDb().prepare("SELECT * FROM dev_tasks WHERE id=?").get(id) as DevTask;
}
export function updateDevTask(id: string, patch: { status?: string; priority?: string; notes?: string }) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  getConfigDb().prepare(`UPDATE dev_tasks SET ${keys.map((k) => `${k}=@${k}`).join(", ")} WHERE id=@id`).run({ ...patch, id });
}
