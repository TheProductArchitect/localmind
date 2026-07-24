/**
 * Gate 2 — after a proposal is approved, open a coding session + SWE loop
 * when a coding project is registered (or LM_SELF_IMPROVE_PROJECT_ID is set).
 */

import { listProposals, setProposalStatus, markProposalNeedsProject, type ImprovementProposal } from "../db/proposals";
import { listCodingProjects } from "../db/coding";
import { createWorktreeSession } from "./worktree";
import { startSweLoop } from "./swe-graph";

function resolveRepoProjectId(proposal: ImprovementProposal): string | null {
  const envId = process.env.LM_SELF_IMPROVE_PROJECT_ID;
  if (envId) return envId;
  const projects = listCodingProjects();
  if (projects.length === 0) return null;
  let targets: string[] = [];
  try {
    targets = JSON.parse(proposal.target_paths || "[]") as string[];
  } catch {
    targets = [];
  }
  for (const p of projects) {
    if (targets.some((t) => typeof t === "string" && (t.includes(p.name) || p.repo_path.includes(t)))) {
      return p.id;
    }
  }
  return projects[0].id;
}

/**
 * Process approved proposals that are not yet building.
 * Safe to call from worker tick; no-ops when nothing pending.
 */
export async function processApprovedProposals(): Promise<{ started: number; errors: string[] }> {
  const approved = listProposals("approved");
  let started = 0;
  const errors: string[] = [];

  for (const proposal of approved.slice(0, 3)) {
    // Skip proposals already annotated as waiting for a project (until one exists).
    if (
      proposal.audit_ref?.startsWith("needs_project:") &&
      listCodingProjects().length === 0 &&
      !process.env.LM_SELF_IMPROVE_PROJECT_ID
    ) {
      errors.push(`${proposal.id}: still waiting for a coding project`);
      continue;
    }

    const projectId = resolveRepoProjectId(proposal);
    if (!projectId) {
      markProposalNeedsProject(proposal.id);
      errors.push(
        `${proposal.id}: no coding project registered (set LM_SELF_IMPROVE_PROJECT_ID or register one on /projects)`
      );
      continue;
    }

    const goal = `${proposal.title}\n\n${proposal.rationale}`.slice(0, 3000);
    const session = createWorktreeSession({ projectId, goal });
    if (!session.ok) {
      errors.push(`${proposal.id}: ${session.error}`);
      continue;
    }

    try {
      setProposalStatus(proposal.id, "building", {
        branch: session.session.branch,
        audit_ref: session.session.id,
      });
    } catch (e) {
      errors.push(`${proposal.id}: ${(e as Error).message}`);
      continue;
    }

    const loop = await startSweLoop(session.session.id);
    if (!loop.ok) {
      errors.push(`${proposal.id}: ${loop.error}`);
      continue;
    }
    started++;
  }

  return { started, errors };
}
