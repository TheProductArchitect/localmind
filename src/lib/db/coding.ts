/**
 * Coding projects + sessions — autonomous SWE path.
 *
 * A project is a registered git repo under approved_dirs.
 * A session is an isolated git worktree + branch; discard = undo.
 */

import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export const SESSION_STATUSES = [
  "active",
  "testing",
  "ready_for_review",
  "discarded",
  "merged",
  "failed",
] as const;
export type CodingSessionStatus = (typeof SESSION_STATUSES)[number];

export type CodingProject = {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string;
  remote_url: string | null;
  github_owner: string | null;
  github_repo: string | null;
  created_at: number;
  updated_at: number;
};

export type CodingSession = {
  id: string;
  project_id: string;
  branch: string;
  worktree_path: string;
  status: CodingSessionStatus;
  goal: string;
  process_id: string | null;
  pr_url: string | null;
  graph_id: string | null;
  created_at: number;
  updated_at: number;
};

export function createCodingProject(args: {
  name: string;
  repo_path: string;
  default_branch?: string;
  remote_url?: string | null;
  github_owner?: string | null;
  github_repo?: string | null;
}): CodingProject {
  const id = `cproj-${nanoid(10)}`;
  const now = Date.now();
  getConfigDb()
    .prepare(
      `INSERT INTO coding_projects
        (id, name, repo_path, default_branch, remote_url, github_owner, github_repo, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      args.name.slice(0, 200),
      args.repo_path,
      args.default_branch || "main",
      args.remote_url ?? null,
      args.github_owner ?? null,
      args.github_repo ?? null,
      now,
      now
    );
  return getCodingProject(id)!;
}

export function getCodingProject(id: string): CodingProject | null {
  return (
    (getConfigDb().prepare("SELECT * FROM coding_projects WHERE id=?").get(id) as CodingProject | undefined) ||
    null
  );
}

export function listCodingProjects(): CodingProject[] {
  return getConfigDb()
    .prepare("SELECT * FROM coding_projects ORDER BY updated_at DESC")
    .all() as CodingProject[];
}

export function deleteCodingProject(id: string): boolean {
  const r = getConfigDb().prepare("DELETE FROM coding_projects WHERE id=?").run(id);
  return r.changes > 0;
}

export function createCodingSession(args: {
  project_id: string;
  branch: string;
  worktree_path: string;
  goal: string;
  process_id?: string | null;
}): CodingSession {
  const id = `csess-${nanoid(10)}`;
  const now = Date.now();
  getConfigDb()
    .prepare(
      `INSERT INTO coding_sessions
        (id, project_id, branch, worktree_path, status, goal, process_id, pr_url, graph_id, created_at, updated_at)
       VALUES (?,?,?,?,'active',?,?,NULL,NULL,?,?)`
    )
    .run(
      id,
      args.project_id,
      args.branch,
      args.worktree_path,
      args.goal.slice(0, 4000),
      args.process_id ?? null,
      now,
      now
    );
  return getCodingSession(id)!;
}

export function getCodingSession(id: string): CodingSession | null {
  return (
    (getConfigDb().prepare("SELECT * FROM coding_sessions WHERE id=?").get(id) as CodingSession | undefined) ||
    null
  );
}

export function listCodingSessions(projectId?: string): CodingSession[] {
  if (projectId) {
    return getConfigDb()
      .prepare("SELECT * FROM coding_sessions WHERE project_id=? ORDER BY created_at DESC")
      .all(projectId) as CodingSession[];
  }
  return getConfigDb()
    .prepare("SELECT * FROM coding_sessions ORDER BY created_at DESC LIMIT 100")
    .all() as CodingSession[];
}

export function listActiveCodingSessions(): CodingSession[] {
  return getConfigDb()
    .prepare(
      "SELECT * FROM coding_sessions WHERE status IN ('active','testing','ready_for_review') ORDER BY updated_at DESC"
    )
    .all() as CodingSession[];
}

export function updateCodingSession(
  id: string,
  patch: {
    status?: CodingSessionStatus;
    process_id?: string | null;
    pr_url?: string | null;
    graph_id?: string | null;
    goal?: string;
    worktree_path?: string;
  }
): CodingSession | null {
  const cur = getCodingSession(id);
  if (!cur) return null;
  const next = {
    status: patch.status ?? cur.status,
    process_id: patch.process_id !== undefined ? patch.process_id : cur.process_id,
    pr_url: patch.pr_url !== undefined ? patch.pr_url : cur.pr_url,
    graph_id: patch.graph_id !== undefined ? patch.graph_id : cur.graph_id,
    goal: patch.goal ?? cur.goal,
    worktree_path: patch.worktree_path ?? cur.worktree_path,
  };
  getConfigDb()
    .prepare(
      `UPDATE coding_sessions SET
         status=?, process_id=?, pr_url=?, graph_id=?, goal=?, worktree_path=?, updated_at=?
       WHERE id=?`
    )
    .run(
      next.status,
      next.process_id,
      next.pr_url,
      next.graph_id,
      next.goal,
      next.worktree_path,
      Date.now(),
      id
    );
  return getCodingSession(id);
}
