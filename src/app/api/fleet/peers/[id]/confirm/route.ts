/**
 * POST /api/fleet/peers/[id]/confirm
 *
 * Relay a user's confirmation decision to the executor peer that raised an
 * ask/pin gate during a chat-relay (M5 remote confirmations).
 *
 * Body: { tool_call_id: string, decision: "allow" | "deny" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/identity";
import { getPeer } from "@/lib/db/fleet";
import { sendConfirmDecisionToPeer } from "@/lib/fleet/confirm-decision-initiator";

export const runtime = "nodejs";

const Body = z.object({
  tool_call_id: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
  pin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const user = currentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const peer = getPeer(params.id);
  if (!peer || peer.trusted !== 1) {
    return NextResponse.json({ error: "Unknown or untrusted peer." }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const result = await sendConfirmDecisionToPeer({
    peer_node_id: params.id,
    tool_call_id: parsed.data.tool_call_id,
    decision: parsed.data.decision,
    pin: parsed.data.pin,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason || "Peer rejected the decision." }, { status: 502 });
  }
  if (!result.matched) {
    return NextResponse.json(
      { error: result.reason || "Confirmation expired before it could be applied.", matched: false },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, matched: true });
}
