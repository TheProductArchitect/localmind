/**
 * coding_project — register git repos and start/discard undoable coding sessions.
 */

import fs from "fs";
import path from "path";
import type { Tool } from "./types";
import {
  createCodingProject,
  getCodingProject,
  getCodingSession,
  listCodingProjects,
  listCodingSessions,
} from "../db/coding";
import { getSettings } from "../db/queries";
import {
  createWorktreeSession,
  discardWorktreeSession,
  detectDefaultBranch,
  detectRemoteUrl,
  expandHome,
  parseGithubRemote,
  pathUnderApproved,
} from "../coding/worktree";

function approvedDirs(): string[] {
  try {
    return JSON.parse(getSettings().approved_dirs || "[]") as string[];
  } catch {
    return [];
  }
}

export const codingProjectTool: Tool = {
  actionType: "write_files",
  classify: (input) => {
    const op = String(input.operation || "");
    if (op === "list_projects" || op === "status" || op === "list_sessions") return "read_files";
    if (op === "discard_session") return "destructive_shell";
    return "write_files";
  },
  preview: (input) => {
    const op = String(input.operation || "coding_project");
    if (op === "start_session") return `Start coding session: ${String(input.goal || "").slice(0, 80)}`;
    if (op === "discard_session") return `Discard coding session ${input.session_id}`;
    if (op === "register_project") return `Register project ${input.name || input.repo_path}`;
    return `coding_project.${op}`;
  },
  version: "1",
  cacheable: () => false,
  definition: {
    name: "coding_project",
    description:
      "Manage coding projects and undoable worktree sessions. Register a local git folder under approved_dirs, start a session (isolated branch), or discard a session (remove worktree + branch). Prefer this before pi_code for multi-step software work.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "list_projects",
            "register_project",
            "list_sessions",
            "start_session",
            "discard_session",
            "status",
          ],
        },
        name: { type: "string" },
        repo_path: { type: "string", description: "Absolute path to a git repo under approved_dirs." },
        project_id: { type: "string" },
        session_id: { type: "string" },
        goal: { type: "string", description: "What to build in the new session." },
        default_branch: { type: "string" },
        run_swe: {
          type: "boolean",
          description: "If true (default), start the SWE graph after creating the session.",
        },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const op = String(input.operation || "");
    const dirs = approvedDirs();

    if (op === "list_projects") {
      const projects = listCodingProjects();
      return {
        ok: true,
        output: projects.length
          ? projects
              .map(
                (p) =>
                  `${p.id}  ${p.name}  ${p.repo_path}  (${p.default_branch})` +
                  (p.github_owner ? `  ${p.github_owner}/${p.github_repo}` : "")
              )
              .join("\n")
          : "(no coding projects registered)",
        summary: `${projects.length} project(s)`,
      };
    }

    if (op === "list_sessions") {
      const sessions = listCodingSessions(
        typeof input.project_id === "string" ? input.project_id : undefined
      );
      return {
        ok: true,
        output: sessions.length
          ? sessions
              .map(
                (s) =>
                  `${s.id}  [${s.status}]  ${s.branch}  ${s.goal.slice(0, 60)}` +
                  (s.pr_url ? `  ${s.pr_url}` : "")
              )
              .join("\n")
          : "(no sessions)",
        summary: `${sessions.length} session(s)`,
      };
    }

    if (op === "status") {
      const sid = String(input.session_id || "");
      const s = getCodingSession(sid);
      if (!s) return { ok: false, output: "Unknown session_id." };
      const p = getCodingProject(s.project_id);
      return {
        ok: true,
        output: JSON.stringify(
          {
            session: s,
            project: p
              ? { id: p.id, name: p.name, repo_path: p.repo_path, default_branch: p.default_branch }
              : null,
          },
          null,
          2
        ),
        summary: `${s.status} on ${s.branch}`,
      };
    }

    if (op === "register_project") {
      const repoPath = expandHome(String(input.repo_path || ""));
      const name = String(input.name || path.basename(repoPath) || "project").slice(0, 200);
      if (!repoPath) return { ok: false, output: "repo_path is required." };
      if (!pathUnderApproved(repoPath, dirs)) {
        return {
          ok: false,
          output:
            "repo_path must be under Settings → approved folders. Add the folder first, then register.",
        };
      }
      try {
        const gitDir = path.join(repoPath, ".git");
        if (!fs.existsSync(gitDir) && !fs.existsSync(repoPath)) {
          return { ok: false, output: "Path does not exist." };
        }
      } catch {
        return { ok: false, output: "Cannot access repo_path." };
      }
      const defaultBranch =
        (typeof input.default_branch === "string" && input.default_branch) ||
        detectDefaultBranch(repoPath);
      const remote = detectRemoteUrl(repoPath);
      const gh = parseGithubRemote(remote);
      const project = createCodingProject({
        name,
        repo_path: repoPath,
        default_branch: defaultBranch,
        remote_url: remote,
        github_owner: gh?.owner ?? null,
        github_repo: gh?.repo ?? null,
      });
      return {
        ok: true,
        output: `Registered project ${project.id}: ${project.name} @ ${project.repo_path} (base ${project.default_branch})`,
        summary: project.id,
      };
    }

    if (op === "start_session") {
      const projectId = String(input.project_id || "");
      const goal = String(input.goal || "").trim();
      if (!projectId) return { ok: false, output: "project_id is required." };
      if (!goal) return { ok: false, output: "goal is required." };
      const { resolvePlacement } = await import("../fleet/placement-pins");
      const placement = await resolvePlacement();
      const result = createWorktreeSession({
        projectId,
        goal,
        computePeerId: placement.compute.kind === "peer" ? placement.compute.peer_node_id : "local",
        workspacePeerId: placement.workspace.kind === "peer" ? placement.workspace.peer_node_id : "local",
      });
      if (!result.ok) return { ok: false, output: result.error };
      const s = result.session;
      const runSwe = input.run_swe !== false && input.run_swe !== "false";
      let graphLine = "";
      if (runSwe) {
        try {
          const { startSweLoop } = await import("../coding/swe-graph");
          const loop = await startSweLoop(s.id);
          if (loop.ok) graphLine = `\ngraph: ${loop.graph_id} (SWE loop started)`;
          else graphLine = `\nSWE loop not started: ${loop.error}`;
        } catch (e) {
          graphLine = `\nSWE loop error: ${(e as Error).message}`;
        }
      }
      return {
        ok: true,
        output: [
          `Started coding session ${s.id}`,
          `branch: ${s.branch}`,
          `worktree: ${s.worktree_path}`,
          `process: ${s.process_id}`,
          `Use coding_session_id=${s.id} with pi_code / filesystem / git (cwd = worktree).`,
          `When done: git.push + git.open_pr, or coding_project.discard_session to undo.`,
          graphLine,
        ]
          .filter(Boolean)
          .join("\n"),
        summary: s.id,
      };
    }

    if (op === "discard_session") {
      const sid = String(input.session_id || "");
      if (!sid) return { ok: false, output: "session_id is required." };
      const result = discardWorktreeSession(sid);
      if (!result.ok) return { ok: false, output: result.error };
      return {
        ok: true,
        output: `Discarded session ${sid} — worktree removed and branch deleted.`,
        summary: "discarded",
      };
    }

    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
