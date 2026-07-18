import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { listActive, listHistory, getBoard, type AgentProcess, type ProcessStatus } from "@/lib/db/agent-processes";
import { listPendingWorkflowApprovals } from "@/lib/db/automations";
import { listProposals, type ImprovementProposal } from "@/lib/db/proposals";

export const runtime = "nodejs";

// Render an improvement proposal as a synthetic board card. `proposed` cards go
// to the Proposals lane (owner Approve/Reject); `ready_for_review` (a built
// branch awaiting merge review) goes to Needs you.
function proposalCard(p: ImprovementProposal, status: ProcessStatus): AgentProcess {
  return {
    process_id: `proposal-${p.id}`,
    process_type: "long_running_job",
    display_name: p.title,
    owner_user_id: null,
    agent_name: "Self-improvement",
    persona_id: null,
    started_at: p.created_at,
    completed_at: null,
    status,
    current_step: p.rationale.slice(0, 160),
    priority: 0,
    metadata_json: JSON.stringify({
      kind: "proposal",
      proposal_id: p.id,
      proposal_status: p.status,
      branch: p.branch,
      pr_url: p.pr_url,
    }),
    pillar: "maintain",
    parent_process_id: null,
    progress: null,
  };
}

// Represent a pending workflow approval as a synthetic board card so the Ops
// board can surface it in the "Needs you" lane in a single fetch.
function approvalsAsCards(): AgentProcess[] {
  return listPendingWorkflowApprovals().map((a) => ({
    process_id: `wf-approval-${a.run_id}`,
    process_type: "workflow",
    display_name: a.workflow_name || "Workflow approval",
    owner_user_id: null,
    agent_name: null,
    persona_id: null,
    started_at: a.triggered_at,
    completed_at: null,
    status: "waiting_confirmation",
    current_step: a.approval_message || "Awaiting your approval",
    priority: 0,
    metadata_json: JSON.stringify({ kind: "workflow_approval", run_id: a.run_id, approval_id: a.approval_id }),
    pillar: "coordinate",
    parent_process_id: null,
    progress: null,
  }));
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;
  const params = req.nextUrl.searchParams;
  if (params.get("board") === "1") {
    const proposals = listProposals("proposed").map((p) => proposalCard(p, "waiting_confirmation"));
    const built = listProposals("ready_for_review").map((p) => proposalCard(p, "waiting_confirmation"));
    const board = getBoard(scope, [...approvalsAsCards(), ...built], proposals);
    return NextResponse.json(board);
  }
  const history = params.get("history") === "1";
  if (history) {
    return NextResponse.json({ processes: listHistory(scope, 50) });
  }
  return NextResponse.json({ processes: listActive(scope) });
}
