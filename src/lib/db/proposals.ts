import { nanoid } from "nanoid";
import { getConfigDb } from ".";

// The self-improvement proposal lifecycle (§7.2). Sora may only ever create a
// card at `proposed`; the owner's approval is what advances it to `approved`
// (which authorizes the build). No transition writes or runs code by itself.
export const PROPOSAL_STATUSES = [
  "proposed",
  "approved",
  "building",
  "ready_for_review",
  "rejected",
  "merged",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type ImprovementProposal = {
  id: string;
  title: string;
  rationale: string;
  target_paths: string; // JSON array
  benefit: string | null;
  risk: string | null;
  status: ProposalStatus;
  created_at: number;
  approved_at: number | null;
  branch: string | null;
  pr_url: string | null;
  audit_ref: string | null;
};

export function createProposal(o: {
  title: string;
  rationale: string;
  target_paths?: string[];
  benefit?: string;
  risk?: string;
}): ImprovementProposal {
  const id = `prop-${nanoid(10)}`;
  getConfigDb()
    .prepare(
      "INSERT INTO improvement_proposals (id,title,rationale,target_paths,benefit,risk,status,created_at) VALUES (?,?,?,?,?,?,'proposed',?)"
    )
    .run(id, o.title, o.rationale, JSON.stringify(o.target_paths ?? []), o.benefit ?? null, o.risk ?? null, Date.now());
  return getProposal(id)!;
}

export function getProposal(id: string): ImprovementProposal | null {
  return (
    (getConfigDb().prepare("SELECT * FROM improvement_proposals WHERE id=?").get(id) as ImprovementProposal | undefined) ||
    null
  );
}

export function listProposals(status?: ProposalStatus): ImprovementProposal[] {
  if (status) {
    return getConfigDb()
      .prepare("SELECT * FROM improvement_proposals WHERE status=? ORDER BY created_at DESC")
      .all(status) as ImprovementProposal[];
  }
  return getConfigDb()
    .prepare("SELECT * FROM improvement_proposals ORDER BY created_at DESC")
    .all() as ImprovementProposal[];
}

/** Valid forward transitions. Enforced so a bug can't skip the approval gate.
 *  Exported (read-only) so the contract is queryable via /api/ops/meta — the
 *  rules stay fixed in code, but any client can discover them. */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: ["approved", "rejected"],
  approved: ["building", "rejected"],
  building: ["ready_for_review", "rejected"],
  ready_for_review: ["merged", "rejected"],
  rejected: [],
  merged: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return PROPOSAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function setProposalStatus(
  id: string,
  status: ProposalStatus,
  patch: { branch?: string; pr_url?: string; audit_ref?: string } = {}
): ImprovementProposal | null {
  const cur = getProposal(id);
  if (!cur) return null;
  if (!canTransition(cur.status, status)) {
    throw new Error(`Illegal proposal transition ${cur.status} → ${status}`);
  }
  getConfigDb()
    .prepare(
      "UPDATE improvement_proposals SET status=?, approved_at=?, branch=COALESCE(?,branch), pr_url=COALESCE(?,pr_url), audit_ref=COALESCE(?,audit_ref) WHERE id=?"
    )
    .run(
      status,
      status === "approved" ? Date.now() : cur.approved_at,
      patch.branch ?? null,
      patch.pr_url ?? null,
      patch.audit_ref ?? null,
      id
    );
  return getProposal(id);
}

/** Annotate an approved proposal that cannot build until a coding project exists. */
export function markProposalNeedsProject(id: string, message?: string): ImprovementProposal | null {
  const cur = getProposal(id);
  if (!cur) return null;
  const note =
    message ||
    "needs_project: Register a coding project on /projects (or set LM_SELF_IMPROVE_PROJECT_ID), then re-approve or wait for the next Gate 2 tick.";
  getConfigDb()
    .prepare("UPDATE improvement_proposals SET audit_ref=? WHERE id=?")
    .run(note, id);
  return getProposal(id);
}
