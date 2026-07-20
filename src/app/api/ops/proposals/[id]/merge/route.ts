import { NextRequest, NextResponse } from "next/server";
import { getProposal, setProposalStatus } from "@/lib/db/proposals";
import { logStart, logComplete } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

/**
 * Gate 2 → done (§7.2). Owner marks a `ready_for_review` proposal as merged
 * after they have reviewed the branch/PR. Does not run git merge itself —
 * that stays human-driven outside the app.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const audit = logStart({
    actionType: "proposal_merge",
    toolName: "self_improve",
    input: { id, title: proposal.title },
    conversationId: null,
    approvedBy: "user",
  });
  try {
    const updated = setProposalStatus(id, "merged", { audit_ref: String(audit) });
    logComplete(audit, "allowed", `merged proposal ${id}`);
    return NextResponse.json({ proposal: updated });
  } catch (e: any) {
    logComplete(audit, "failed", e?.message || "merge failed");
    return NextResponse.json({ error: e?.message || "merge failed" }, { status: 400 });
  }
}
