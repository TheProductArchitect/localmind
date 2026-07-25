/**
 * git — session-scoped git ops for autonomous coding.
 *
 * Push refuses protected branches (main/master/…). Force-push is classified
 * destructive. Prefer coding_project sessions so cwd is the worktree.
 */

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Tool } from "./types";
import { getCodingSession, getCodingProject, updateCodingSession } from "../db/coding";
import { expandHome, isProtectedBranch, pathUnderApproved } from "../coding/worktree";
import { getSettings } from "../db/queries";

function approvedDirs(): string[] {
  try {
    return JSON.parse(getSettings().approved_dirs || "[]") as string[];
  } catch {
    return [];
  }
}

function resolveCwd(
  input: Record<string, unknown>,
  ctx: { codingSessionId?: string | null; approvedDirs: string[] }
): { ok: true; cwd: string; sessionId?: string } | { ok: false; error: string } {
  const sid =
    (typeof input.coding_session_id === "string" && input.coding_session_id) ||
    ctx.codingSessionId ||
    null;
  if (sid) {
    const s = getCodingSession(sid);
    if (!s) return { ok: false, error: "Unknown coding_session_id." };
    if (s.status === "discarded") return { ok: false, error: "Session was discarded." };
    if (!fs.existsSync(s.worktree_path)) {
      return { ok: false, error: `Worktree missing: ${s.worktree_path}` };
    }
    return { ok: true, cwd: s.worktree_path, sessionId: sid };
  }
  const cwd = typeof input.cwd === "string" ? expandHome(input.cwd) : "";
  if (!cwd) {
    return {
      ok: false,
      error: "coding_session_id or cwd is required.",
    };
  }
  const dirs = ctx.approvedDirs.length ? ctx.approvedDirs : approvedDirs();
  if (!pathUnderApproved(cwd, dirs)) {
    return { ok: false, error: "cwd is not under approved_dirs / session worktree." };
  }
  return { ok: true, cwd };
}

function git(cwd: string, args: string[], timeoutMs = 120_000): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function currentBranch(cwd: string): string {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export const gitTool: Tool = {
  actionType: "write_files",
  classify: (input) => {
    const op = String(input.operation || "");
    if (op === "status" || op === "diff" || op === "log") return "read_files";
    if (op === "push") {
      const force = Boolean(input.force) || String(input.args || "").includes("--force");
      return force ? "git_force_push" : "write_files";
    }
    return "write_files";
  },
  preview: (input) => {
    const op = String(input.operation || "git");
    if (op === "commit") return `git commit: ${String(input.message || "").slice(0, 60)}`;
    if (op === "push") return `git push${input.force ? " --force" : ""}`;
    if (op === "open_pr") return `Open PR: ${String(input.title || "").slice(0, 60)}`;
    return `git.${op}`;
  },
  version: "1",
  cacheable: (input) => {
    const op = String(input.operation || "");
    return op === "status" || op === "diff" || op === "log";
  },
  definition: {
    name: "git",
    description:
      "Git operations inside a coding session worktree (or approved cwd). Push only feature branches — never main/master. open_pr uses gh when available.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["status", "diff", "log", "add", "commit", "push", "open_pr"],
        },
        coding_session_id: { type: "string" },
        cwd: { type: "string" },
        message: { type: "string", description: "Commit message (commit)." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Paths for add (default: all).",
        },
        force: { type: "boolean", description: "Force push — always requires confirmation." },
        title: { type: "string", description: "PR title." },
        body: { type: "string", description: "PR body." },
        base: { type: "string", description: "PR base branch (default: project default)." },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const op = String(input.operation || "");
    const resolved = resolveCwd(input, ctx);
    if (!resolved.ok) return { ok: false, output: resolved.error };
    const { cwd, sessionId } = resolved;

    try {
      if (op === "status") {
        const out = git(cwd, ["status", "--short", "--branch"]);
        return { ok: true, output: out || "(clean)", summary: "status" };
      }
      if (op === "diff") {
        const staged = git(cwd, ["diff", "--cached"]);
        const unstaged = git(cwd, ["diff"]);
        const out = [staged && `=== staged ===\n${staged}`, unstaged && `=== unstaged ===\n${unstaged}`]
          .filter(Boolean)
          .join("\n\n");
        return { ok: true, output: out || "(no diff)", summary: "diff" };
      }
      if (op === "log") {
        const out = git(cwd, ["log", "-n", "15", "--oneline"]);
        return { ok: true, output: out || "(no commits)", summary: "log" };
      }
      if (op === "add") {
        const paths = Array.isArray(input.paths)
          ? (input.paths as string[]).filter((p) => typeof p === "string")
          : [];
        if (paths.length === 0) git(cwd, ["add", "-A"]);
        else git(cwd, ["add", "--", ...paths]);
        return { ok: true, output: git(cwd, ["status", "--short"]), summary: "added" };
      }
      if (op === "commit") {
        const message = String(input.message || "").trim();
        if (!message) return { ok: false, output: "message is required for commit." };
        git(cwd, ["commit", "-m", message]);
        return { ok: true, output: git(cwd, ["log", "-1", "--oneline"]), summary: "committed" };
      }
      if (op === "push") {
        const branch = currentBranch(cwd);
        if (isProtectedBranch(branch)) {
          return {
            ok: false,
            output: `Refusing to push protected branch "${branch}". Use a feature branch (localmind/…).`,
          };
        }
        // Refuse explicit refspecs that target protected branch names (main/master/…).
        const extraArgs = String(input.args || "");
        const refHit = extraArgs.match(/(?:^|[\s:])((?:refs\/heads\/)?[A-Za-z0-9._/-]+)$/);
        if (refHit && isProtectedBranch(refHit[1])) {
          return {
            ok: false,
            output: `Refusing to push to protected branch "${refHit[1]}". Feature branch + PR only.`,
          };
        }
        for (const token of extraArgs.split(/\s+/).filter(Boolean)) {
          const tip = token.includes(":") ? token.split(":").pop()! : token;
          if (isProtectedBranch(tip.replace(/^refs\/heads\//, ""))) {
            return {
              ok: false,
              output: `Refusing to push to protected branch "${tip}". Feature branch + PR only.`,
            };
          }
        }
        const args = input.force
          ? ["push", "--force-with-lease", "-u", "origin", branch]
          : ["push", "-u", "origin", branch];
        const out = git(cwd, args, 180_000);
        return { ok: true, output: out || `Pushed ${branch} to origin.`, summary: `pushed ${branch}` };
      }
      if (op === "open_pr") {
        const branch = currentBranch(cwd);
        if (isProtectedBranch(branch)) {
          return { ok: false, output: `Refusing PR from protected branch "${branch}".` };
        }
        let base = typeof input.base === "string" ? input.base : "";
        if (!base && sessionId) {
          const s = getCodingSession(sessionId);
          const p = s ? getCodingProject(s.project_id) : null;
          base = p?.default_branch || "main";
        }
        if (!base) base = "main";
        if (isProtectedBranch(branch) || branch === base) {
          /* branch === base is bad */
        }
        if (branch === base) {
          return { ok: false, output: "Cannot open a PR from the base branch onto itself." };
        }
        const title =
          String(input.title || "").trim() ||
          (sessionId ? getCodingSession(sessionId)?.goal.slice(0, 72) : "") ||
          `localmind: ${branch}`;
        const body = String(input.body || "").trim() || "Opened by LocalMind coding session.";

        const gh = spawnSync(
          "gh",
          ["pr", "create", "--title", title, "--body", body, "--base", base, "--head", branch],
          { cwd, encoding: "utf8", timeout: 120_000 }
        );
        if (gh.error || gh.status !== 0) {
          const err = (gh.stderr || gh.stdout || gh.error?.message || "gh failed").toString();
          return {
            ok: false,
            output: `gh pr create failed. Install/auth GitHub CLI or open a PR manually.\n${err}`,
          };
        }
        const url = (gh.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
        if (sessionId && url) {
          updateCodingSession(sessionId, { status: "ready_for_review", pr_url: url });
        }
        return { ok: true, output: url || "PR created.", summary: url || "pr" };
      }
      return { ok: false, output: `Unknown operation: ${op}` };
    } catch (e) {
      return { ok: false, output: (e as Error).message || "git failed" };
    }
  },
};
