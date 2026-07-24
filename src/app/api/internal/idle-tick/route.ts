import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { runIdleCycle } from "@/lib/agent/idle-cycle";
import { processApprovedProposals } from "@/lib/coding/gate2";
import { listProposals, setProposalStatus } from "@/lib/db/proposals";
import { getCodingSession } from "@/lib/db/coding";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Worker-driven idle tick. Also advances Gate 2:
 * approved proposals → coding session + SWE loop;
 * building proposals with a PR → ready_for_review.
 */
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await runIdleCycle();

  let gate2: { started: number; errors: string[]; promoted: number } = {
    started: 0,
    errors: [],
    promoted: 0,
  };
  try {
    const r = await processApprovedProposals();
    gate2.started = r.started;
    gate2.errors = r.errors;
    for (const p of listProposals("building")) {
      const sessionId = p.audit_ref;
      if (!sessionId?.startsWith("csess-")) continue;
      const s = getCodingSession(sessionId);
      if (s?.pr_url) {
        try {
          setProposalStatus(p.id, "ready_for_review", { pr_url: s.pr_url, branch: s.branch });
          gate2.promoted++;
        } catch { /* */ }
      }
    }
  } catch (e) {
    gate2.errors.push((e as Error).message);
  }

  return NextResponse.json({ ...result, gate2 });
}
