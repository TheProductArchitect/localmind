/**
 * Git worktree sessions for undoable autonomous coding.
 *
 * Worktrees live under ~/.localmind/workspaces/<projectId>/<sessionId>/
 * Discard removes the worktree and deletes the session branch.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { WORKSPACES_DIR, ensureDataDir } from "../paths";
import {
  createCodingSession,
  getCodingProject,
  getCodingSession,
  updateCodingSession,
  type CodingSession,
} from "../db/coding";
import { getSettings } from "../db/queries";
import { startProcess, updateProcess, completeProcess } from "../db/agent-processes";

const PROTECTED = new Set(["main", "master", "trunk", "production", "prod"]);

function git(cwd: string, args: string[], timeoutMs = 60_000): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

export function isProtectedBranch(name: string): boolean {
  const b = name.replace(/^refs\/heads\//, "").toLowerCase();
  return PROTECTED.has(b);
}

export function expandHome(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || ""));
}

/** True if absPath is under one of the approved dirs (realpath). */
export function pathUnderApproved(absPath: string, approvedDirs: string[]): boolean {
  if (!approvedDirs.length) return false;
  let real: string;
  try {
    real = fs.realpathSync(absPath);
  } catch {
    // Path may not exist yet — walk up to existing ancestor
    let cur = absPath;
    while (cur !== path.dirname(cur) && !fs.existsSync(cur)) cur = path.dirname(cur);
    try {
      real = path.join(fs.realpathSync(cur), path.relative(cur, absPath));
    } catch {
      return false;
    }
  }
  for (const dir of approvedDirs) {
    let realDir: string;
    try {
      realDir = fs.realpathSync(expandHome(dir));
    } catch {
      continue;
    }
    if (real === realDir || real.startsWith(realDir + path.sep)) return true;
  }
  return false;
}

export function detectDefaultBranch(repoPath: string): string {
  try {
    const sym = git(repoPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const m = sym.match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch { /* */ }
  try {
    const b = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (b && b !== "HEAD") return b;
  } catch { /* */ }
  return "main";
}

export function detectRemoteUrl(repoPath: string): string | null {
  try {
    return git(repoPath, ["remote", "get-url", "origin"]) || null;
  } catch {
    return null;
  }
}

export function parseGithubRemote(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const m =
    url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i) ||
    url.match(/github\.com\/([^/]+)\/([^/.]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";
}

export type CreateSessionResult =
  | { ok: true; session: CodingSession }
  | { ok: false; error: string };

export function createWorktreeSession(args: {
  projectId: string;
  goal: string;
  ownerUserId?: string | null;
}): CreateSessionResult {
  ensureDataDir();
  const project = getCodingProject(args.projectId);
  if (!project) return { ok: false, error: "Unknown project." };

  const approved = (() => {
    try {
      return JSON.parse(getSettings().approved_dirs || "[]") as string[];
    } catch {
      return [];
    }
  })();
  const repoPath = expandHome(project.repo_path);
  if (!pathUnderApproved(repoPath, approved)) {
    return { ok: false, error: "Project repo_path is not under approved_dirs." };
  }
  if (!fs.existsSync(path.join(repoPath, ".git")) && !fs.existsSync(repoPath)) {
    return { ok: false, error: "Not a git repository." };
  }
  // Bare .git file (worktree) or directory
  try {
    git(repoPath, ["rev-parse", "--git-dir"]);
  } catch {
    return { ok: false, error: "Not a git repository." };
  }

  const base = project.default_branch || detectDefaultBranch(repoPath);
  const processId = startProcess({
    process_type: "long_running_job",
    display_name: `Coding: ${args.goal.slice(0, 80)}`,
    owner_user_id: args.ownerUserId ?? null,
    agent_name: "Sora",
    pillar: "execute",
    metadata: { kind: "coding_session", project_id: project.id, goal: args.goal },
  });

  const tmpId = `tmp-${Date.now().toString(36)}`;
  const worktreePath = path.join(WORKSPACES_DIR, project.id, tmpId);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const branch = `localmind/${slugify(args.goal)}-${tmpId.slice(-6)}`;
  if (isProtectedBranch(branch)) {
    completeProcess(processId, "failed");
    return { ok: false, error: "Refusing to create a protected branch name." };
  }

  try {
    try {
      git(repoPath, ["rev-parse", "--verify", base]);
    } catch {
      try {
        git(repoPath, ["fetch", "origin", base]);
      } catch { /* use whatever HEAD is */ }
    }
    git(repoPath, ["worktree", "add", "-b", branch, worktreePath, base]);
  } catch (e) {
    updateProcess(processId, { status: "failed", current_step: (e as Error).message });
    completeProcess(processId, "failed");
    return { ok: false, error: `worktree add failed: ${(e as Error).message}` };
  }

  const session = createCodingSession({
    project_id: project.id,
    branch,
    worktree_path: worktreePath,
    goal: args.goal,
    process_id: processId,
  });

  const finalPath = path.join(WORKSPACES_DIR, project.id, session.id);
  if (finalPath !== worktreePath) {
    try {
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      try {
        git(repoPath, ["worktree", "move", worktreePath, finalPath]);
      } catch {
        fs.renameSync(worktreePath, finalPath);
        try {
          git(repoPath, ["worktree", "repair"]);
        } catch { /* best-effort */ }
      }
      updateCodingSession(session.id, { worktree_path: finalPath });
    } catch (e) {
      console.warn("[coding] worktree move failed:", (e as Error).message);
    }
  }

  const fresh = getCodingSession(session.id)!;
  updateProcess(processId, {
    current_step: `session ${session.id} on ${branch}`,
    metadata: {
      kind: "coding_session",
      project_id: project.id,
      session_id: session.id,
      branch,
      worktree_path: fresh.worktree_path,
      goal: args.goal,
    },
  });

  return { ok: true, session: fresh };
}

export type DiscardResult = { ok: true } | { ok: false; error: string };

export function discardWorktreeSession(sessionId: string): DiscardResult {
  const session = getCodingSession(sessionId);
  if (!session) return { ok: false, error: "Unknown session." };
  if (session.status === "discarded") return { ok: true };

  const project = getCodingProject(session.project_id);
  if (!project) return { ok: false, error: "Project missing." };
  const repoPath = expandHome(project.repo_path);

  try {
    if (fs.existsSync(session.worktree_path)) {
      git(repoPath, ["worktree", "remove", "--force", session.worktree_path]);
    } else {
      try {
        git(repoPath, ["worktree", "prune"]);
      } catch { /* */ }
    }
  } catch (e) {
    // Force-remove directory if git fails
    try {
      fs.rmSync(session.worktree_path, { recursive: true, force: true });
      git(repoPath, ["worktree", "prune"]);
    } catch {
      return { ok: false, error: `Failed to remove worktree: ${(e as Error).message}` };
    }
  }

  if (!isProtectedBranch(session.branch)) {
    try {
      git(repoPath, ["branch", "-D", session.branch]);
    } catch { /* branch may already be gone */ }
  }

  updateCodingSession(sessionId, { status: "discarded" });
  if (session.process_id) {
    try {
      updateProcess(session.process_id, { status: "cancelled", current_step: "session discarded" });
      completeProcess(session.process_id, "cancelled");
    } catch { /* */ }
  }
  return { ok: true };
}

/** Approved dirs overlay for a coding session — worktree only. */
export function sessionApprovedDirs(sessionId: string): string[] | null {
  const s = getCodingSession(sessionId);
  if (!s || s.status === "discarded") return null;
  return [s.worktree_path];
}
