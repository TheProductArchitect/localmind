/**
 * Initiator-side sender: relay a user's confirmation decision back to the
 * executor peer that raised it during a chat-relay. See handlers/confirm-decision.
 */

import { sendToPeer } from "./peer-client";
import type {
  ConfirmDecisionRequest,
  ConfirmDecisionResponse,
} from "./handlers/confirm-decision";

export async function sendConfirmDecisionToPeer(args: {
  peer_node_id: string;
  tool_call_id: string;
  decision: "allow" | "deny";
  pin?: string;
  timeout_ms?: number;
}): Promise<{ ok: boolean; matched?: boolean; reason?: string }> {
  const result = await sendToPeer<ConfirmDecisionRequest, ConfirmDecisionResponse>(
    args.peer_node_id,
    "confirm-decision",
    { tool_call_id: args.tool_call_id, decision: args.decision, pin: args.pin },
    { timeoutMs: args.timeout_ms ?? 10_000 }
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const body = result.envelope.payload;
  return { ok: body.ok, matched: body.matched, reason: body.error };
}
