import { NextRequest, NextResponse } from "next/server";
import { getProposal, setProposalStatus } from "@/lib/db/proposals";
import { logStart, logComplete } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

// Owner-only. A rejected (or ignored) proposal never touches code (§7.2).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const audit = logStart({
    actionType: "proposal_reject",
    toolName: "self_improve",
    input: { id },
    conversationId: null,
    approvedBy: "user",
  });
  try {
    const updated = setProposalStatus(id, "rejected");
    logComplete(audit, "allowed", `rejected proposal ${id}`);
    return NextResponse.json({ proposal: updated });
  } catch (e: any) {
    logComplete(audit, "failed", e?.message || "reject failed");
    return NextResponse.json({ error: e?.message || "reject failed" }, { status: 400 });
  }
}
