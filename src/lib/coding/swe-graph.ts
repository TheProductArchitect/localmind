/**
 * SWE graph template — plan → implement → test → review → ship.
 */

import { buildLinear } from "../graph/build";
import type { TaskGraph } from "../graph/types";
import { getCodingSession, getCodingProject, updateCodingSession } from "../db/coding";
import { updateProcess } from "../db/agent-processes";

export function buildSweGraph(args: {
  sessionId: string;
  goal: string;
  worktreePath: string;
  ownerUserId?: string | null;
}): TaskGraph {
  const { sessionId, goal, worktreePath } = args;
  const sessionHint = `coding_session_id=${sessionId}`;
  const cwdHint = `cwd=${worktreePath}`;

  return buildLinear({
    root_goal: `SWE: ${goal.slice(0, 180)}`,
    opts: { owner_user_id: args.ownerUserId ?? null },
    nodes: [
      {
        agent_spec: {
          persona_id: "persona-strategist",
          tools: ["filesystem", "devpm_codebase", "memory", "time"],
          prompt_template: [
            "You are planning a coding change. Read-only.",
            `Goal: ${goal}`,
            `Worktree: ${worktreePath} (${sessionHint}).`,
            "Produce: acceptance criteria, files likely to touch, test plan.",
            "Do not edit files.",
          ].join("\n"),
          max_iterations: 8,
        },
        input: {
          message: `Plan implementation for: ${goal}`,
          system_prefix: "",
          coding_session_id: sessionId,
        },
        contract: { cost_budget: { tokens: 6000, wall_seconds: 180 } },
      },
      {
        agent_spec: {
          persona_id: "agent-coder",
          tools: ["filesystem", "pi_code", "git", "memory", "time", "devpm_codebase"],
          prompt_template: [
            "Implement the plan in the worktree only.",
            `Goal: ${goal}`,
            `Use ${sessionHint} for git and pi_code. Prefer pi_code with ${cwdHint}.`,
            "Commit with a clear message when done. Do not push yet.",
          ].join("\n"),
          max_iterations: 12,
        },
        input: {
          message: `Implement: ${goal}`,
          system_prefix: "",
          coding_session_id: sessionId,
        },
        contract: { cost_budget: { tokens: 16000, wall_seconds: 600 } },
      },
      {
        agent_spec: {
          persona_id: "agent-coder",
          tools: ["git", "filesystem", "devpm_codebase", "time"],
          prompt_template: [
            "Verify the change. Prefer running the project's test script via available tools.",
            `Worktree: ${worktreePath}. ${sessionHint}.`,
            "If tests fail, summarize failures; do not push.",
            "If no test runner is available, run git.diff and sanity-check the change.",
          ].join("\n"),
          max_iterations: 8,
        },
        input: {
          message: `Test/verify: ${goal}`,
          system_prefix: "",
          coding_session_id: sessionId,
        },
        contract: { cost_budget: { tokens: 8000, wall_seconds: 300 } },
      },
      {
        agent_spec: {
          persona_id: "agent-reviewer",
          tools: ["git", "filesystem", "memory", "time"],
          prompt_template: [
            "Review the diff (git.diff / git.status). Read-only.",
            "List risks and whether the change is ready to ship.",
            `Session ${sessionId}.`,
          ].join("\n"),
          max_iterations: 6,
        },
        input: {
          message: `Review: ${goal}`,
          system_prefix: "",
          coding_session_id: sessionId,
        },
        contract: { cost_budget: { tokens: 6000, wall_seconds: 180 } },
      },
      {
        agent_spec: {
          persona_id: "agent-coder",
          tools: ["git", "time"],
          prompt_template: [
            "Ship: git.push then git.open_pr for this feature branch only.",
            `Never push main/master. ${sessionHint}.`,
            `PR title should summarize: ${goal.slice(0, 72)}`,
          ].join("\n"),
          max_iterations: 6,
        },
        input: {
          message: `Ship PR for: ${goal}`,
          system_prefix: "",
          coding_session_id: sessionId,
        },
        contract: { cost_budget: { tokens: 4000, wall_seconds: 180 } },
      },
    ],
  });
}

/** Start SWE graph for an existing session; records graph_id on the session. */
export async function startSweLoop(sessionId: string): Promise<{ ok: boolean; graph_id?: string; error?: string }> {
  const session = getCodingSession(sessionId);
  if (!session) return { ok: false, error: "Unknown session." };
  if (session.status === "discarded") return { ok: false, error: "Session discarded." };
  const project = getCodingProject(session.project_id);
  if (!project) return { ok: false, error: "Project missing." };

  const graph = buildSweGraph({
    sessionId: session.id,
    goal: session.goal,
    worktreePath: session.worktree_path,
  });
  updateCodingSession(session.id, { graph_id: graph.graph_id, status: "testing" });
  if (session.process_id) {
    updateProcess(session.process_id, {
      current_step: `SWE graph ${graph.graph_id}`,
      metadata: {
        kind: "coding_session",
        session_id: session.id,
        project_id: session.project_id,
        graph_id: graph.graph_id,
        branch: session.branch,
        worktree_path: session.worktree_path,
        goal: session.goal,
      },
    });
  }

  // Execute asynchronously via graph executor
  const { executeGraph } = await import("../graph/executor");
  const { createPlacementRunner } = await import("../graph/runner-placement");
  void executeGraph(graph.graph_id, {
    runner: createPlacementRunner(),
    skip_refute: true,
  })
    .then((outcome) => {
      const s = getCodingSession(sessionId);
      if (!s) return;
      if (outcome.final_status === "completed") {
        updateCodingSession(sessionId, {
          status: s.pr_url ? "ready_for_review" : "active",
        });
        if (s.process_id) {
          updateProcess(s.process_id, {
            status: s.pr_url ? "waiting_confirmation" : "running",
            current_step: s.pr_url ? `PR ready: ${s.pr_url}` : "SWE graph completed",
          });
        }
      } else {
        updateCodingSession(sessionId, { status: "failed" });
        if (s.process_id) {
          updateProcess(s.process_id, {
            status: "failed",
            current_step: `graph ${outcome.final_status}`,
          });
        }
      }
    })
    .catch((e) => {
      updateCodingSession(sessionId, { status: "failed" });
      const s = getCodingSession(sessionId);
      if (s?.process_id) {
        updateProcess(s.process_id, {
          status: "failed",
          current_step: (e as Error).message,
        });
      }
    });

  return { ok: true, graph_id: graph.graph_id };
}
