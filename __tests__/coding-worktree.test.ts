import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => ({ approved_dirs: JSON.stringify([os.tmpdir()]) }),
}));

vi.mock("../src/lib/db/agent-processes", () => ({
  startProcess: vi.fn(() => "proc-test"),
  updateProcess: vi.fn(),
  completeProcess: vi.fn(),
}));

const store = {
  projects: [] as any[],
  sessions: [] as any[],
};

vi.mock("../src/lib/db/coding", () => ({
  createCodingProject: (args: any) => {
    const p = { id: "cproj-1", created_at: Date.now(), updated_at: Date.now(), ...args };
    store.projects.push(p);
    return p;
  },
  getCodingProject: (id: string) => store.projects.find((p) => p.id === id) || null,
  listCodingProjects: () => store.projects,
  createCodingSession: (args: any) => {
    const s = {
      id: `csess-${store.sessions.length + 1}`,
      status: "active",
      process_id: args.process_id,
      pr_url: null,
      graph_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      ...args,
    };
    store.sessions.push(s);
    return s;
  },
  getCodingSession: (id: string) => store.sessions.find((s) => s.id === id) || null,
  updateCodingSession: (id: string, patch: any) => {
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch, { updated_at: Date.now() });
    return s;
  },
  listCodingSessions: () => store.sessions,
}));

import { isProtectedBranch, pathUnderApproved, createWorktreeSession, discardWorktreeSession } from "../src/lib/coding/worktree";
import { gitTool } from "../src/lib/tools/git";

describe("isProtectedBranch", () => {
  it("protects main/master", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
    expect(isProtectedBranch("localmind/feat-x")).toBe(false);
  });
});

describe("pathUnderApproved", () => {
  it("allows paths under approved roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-appr-"));
    const child = path.join(root, "repo");
    fs.mkdirSync(child);
    expect(pathUnderApproved(child, [root])).toBe(true);
    expect(pathUnderApproved("/tmp/other-place-xyz", [root])).toBe(false);
  });
});

describe("worktree session", () => {
  let repo: string;

  beforeEach(() => {
    store.projects.length = 0;
    store.sessions.length = 0;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "lm-repo-"));
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "--template="], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@localmind"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "hi\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    store.projects.push({
      id: "cproj-1",
      name: "demo",
      repo_path: repo,
      default_branch: "main",
      remote_url: null,
      github_owner: null,
      github_repo: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  });

  afterEach(() => {
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: repo });
    } catch { /* */ }
  });

  it("creates and discards a worktree session", () => {
    const created = createWorktreeSession({ projectId: "cproj-1", goal: "Add a widget" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(fs.existsSync(created.session.worktree_path)).toBe(true);
    expect(created.session.branch.startsWith("localmind/")).toBe(true);

    const discarded = discardWorktreeSession(created.session.id);
    expect(discarded.ok).toBe(true);
    expect(fs.existsSync(created.session.worktree_path)).toBe(false);
  });
});

describe("git tool push guard", () => {
  it("refuses push on main", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lm-git-"));
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "--template="], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@localmind"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const result = await gitTool.execute(
      { operation: "push", cwd: repo },
      { conversationId: "c", approvedDirs: [os.tmpdir()] }
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/protected/i);
  });

  it("sessionApprovedDirs returns worktree for active session", async () => {
    const { sessionApprovedDirs } = await import("../src/lib/coding/worktree");
    store.sessions.push({
      id: "csess-active",
      project_id: "cproj-1",
      branch: "localmind/x",
      worktree_path: "/tmp/wt-active",
      status: "active",
      goal: "g",
      process_id: null,
      pr_url: null,
      graph_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    expect(sessionApprovedDirs("csess-active")).toEqual(["/tmp/wt-active"]);
    expect(sessionApprovedDirs("missing")).toBeNull();
  });
});
