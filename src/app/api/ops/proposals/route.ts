import { NextRequest, NextResponse } from "next/server";
import { listProposals, createProposal } from "@/lib/db/proposals";
import { logStart, logComplete } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ proposals: listProposals() });
}

// Owner-only (route-map). Manual creation mirrors what the idle cycle does in
// `propose` mode; the card starts at `proposed` and never touches code.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const rationale = String(body.rationale || "").trim();
  if (!title || !rationale) {
    return NextResponse.json({ error: "title and rationale are required" }, { status: 400 });
  }
  const audit = logStart({
    actionType: "proposal_create",
    toolName: "self_improve",
    input: { title, target_paths: body.target_paths },
    conversationId: null,
    approvedBy: "user",
  });
  const proposal = createProposal({
    title,
    rationale,
    target_paths: Array.isArray(body.target_paths) ? body.target_paths : [],
    benefit: body.benefit,
    risk: body.risk,
  });
  logComplete(audit, "allowed", `created proposal ${proposal.id}`);
  return NextResponse.json({ proposal });
}
