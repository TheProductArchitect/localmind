import { NextRequest, NextResponse } from "next/server";
import { getProposal, setProposalStatus } from "@/lib/db/proposals";
import { logStart, logComplete } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

/**
 * Gate 1 → Gate 2 (§7.2). Owner-only. Approving a `proposed` card is what
 * authorizes Sora to build it: the card advances to `approved` and the worker's
 * idle cycle will produce a branch/PR. This does NOT merge, hot-patch, or
 * restart the app — final merge is always human.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const audit = logStart({
    actionType: "proposal_approve",
    toolName: "self_improve",
    input: { id, title: proposal.title },
    conversationId: null,
    approvedBy: "user",
  });
  try {
    const updated = setProposalStatus(id, "approved", { audit_ref: String(audit) });
    logComplete(audit, "allowed", `approved proposal ${id} — build authorized`);
    return NextResponse.json({ proposal: updated });
  } catch (e: any) {
    logComplete(audit, "failed", e?.message || "approve failed");
    return NextResponse.json({ error: e?.message || "approve failed" }, { status: 400 });
  }
}
