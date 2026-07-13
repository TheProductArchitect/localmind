import { NextResponse } from "next/server";
import { PILLAR_INFO, PILLARS } from "@/lib/pillars";
import { BOARD_LANES } from "@/lib/db/agent-processes";
import { PROPOSAL_STATUSES, PROPOSAL_TRANSITIONS } from "@/lib/db/proposals";

export const runtime = "nodejs";

// Self-describing Ops contracts. These stay fixed in code (they back DB columns
// and the approval guardrail) but are queryable so any client or agent can
// discover the taxonomy instead of hard-coding it.
export async function GET() {
  return NextResponse.json({
    pillars: PILLARS.map((id) => ({ id, ...PILLAR_INFO[id] })),
    boardLanes: BOARD_LANES,
    proposalStatuses: PROPOSAL_STATUSES,
    proposalTransitions: PROPOSAL_TRANSITIONS,
  });
}
