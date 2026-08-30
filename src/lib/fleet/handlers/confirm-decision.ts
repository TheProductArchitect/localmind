/**
 * /fleet/confirm-decision — the initiator answers an `ask`/`pin` confirmation
 * that the EXECUTOR raised mid chat-relay.
 *
 * Flow (M5, remote confirmations):
 *   1. Executor's engine hits a destructive tool, yields `confirmation_required`
 *      and blocks on awaitConfirmation(tool_call_id) in THIS process.
 *   2. That event was streamed to the initiator over the chat-relay NDJSON
 *      channel, which surfaced a confirmation card to the user.
 *   3. The user's decision comes back here as a fresh signed RPC (the NDJSON
 *      response stream is one-way, so we need a separate call).
 *   4. submitConfirmation resolves the blocked awaitConfirmation, unblocking
 *      the executor's engine so the turn continues.
 *
 * Security: mTLS + signed envelope + trusted peer (verified by the dispatcher).
 * tool_call_id is an unguessable per-call nanoid, so a trusted peer can only
 * resolve confirmations it was actually shown.
 */

import { getPeer } from "../../db/fleet";
import { submitConfirmation, confirmationRequiresPin } from "../../agent/confirmations";
import { getSettings } from "../../db/queries";
import { logSecurityEvent } from "../../db/jobs";
import type { SignedEnvelope } from "../envelope";

export type ConfirmDecisionRequest = {
  tool_call_id: string;
  decision: "allow" | "deny";
  /** Required when the executor's gate is pin-tier; validated against OUR pin. */
  pin?: string;
};

export type ConfirmDecisionResponse = {
  ok: boolean;
  /** True when a pending confirmation actually matched (else it already timed out). */
  matched: boolean;
  error?: string;
};

// PIN brute-force lockout (in-memory, resets on restart) — mirrors /api/chat/confirm.
let pinAttempts = { count: 0, until: 0 };

export async function handleConfirmDecision(args: {
  envelope: SignedEnvelope<ConfirmDecisionRequest>;
  senderNodeId: string;
}): Promise<ConfirmDecisionResponse> {
  const peer = getPeer(args.senderNodeId);
  if (!peer || peer.trusted !== 1) {
    return { ok: false, matched: false, error: "Peer not trusted." };
  }
  const payload = args.envelope.payload || ({} as ConfirmDecisionRequest);
  const toolCallId = String(payload.tool_call_id || "");
  const decision = payload.decision;
  if (!toolCallId || (decision !== "allow" && decision !== "deny")) {
    return { ok: false, matched: false, error: "Invalid confirm-decision payload." };
  }

  const requiresPin = confirmationRequiresPin(toolCallId);
  if (requiresPin === null) {
    return { ok: false, matched: false, error: "No pending confirmation for that id (it may have timed out)." };
  }

  // PIN-tier gates are validated against THIS node's PIN — the executor owns
  // the action, so a remote allow can't bypass its own pin floor.
  if (decision === "allow" && requiresPin) {
    const s = getSettings();
    if (!s.pin_hash) {
      return { ok: false, matched: false, error: "This action needs a PIN on the compute node, but none is set there." };
    }
    if (pinAttempts.until > Date.now()) {
      return { ok: false, matched: false, error: "Too many incorrect PIN attempts. Try again in a few minutes." };
    }
    if (typeof payload.pin !== "string" || payload.pin.length < 4) {
      return { ok: false, matched: false, error: "A PIN is required to allow this action." };
    }
    const bcrypt = (await import("bcryptjs")).default;
    const ok = await bcrypt.compare(payload.pin, s.pin_hash);
    if (!ok) {
      pinAttempts.count++;
      if (pinAttempts.count >= 3) pinAttempts.until = Date.now() + 5 * 60_000;
      try {
        logSecurityEvent("pin_failed", `Incorrect PIN on remote confirmation ${toolCallId}`);
      } catch {
        /* best-effort */
      }
      return { ok: false, matched: false, error: "Incorrect PIN." };
    }
    pinAttempts = { count: 0, until: 0 };
  }

  const matched = submitConfirmation(toolCallId, decision);
  // Fail closed if the pending entry raced with a timeout during PIN check —
  // returning ok:true + matched:false caused the initiator UI to clear the
  // card while the executor had already denied.
  if (!matched) {
    return {
      ok: false,
      matched: false,
      error: "Confirmation expired before the decision was applied.",
    };
  }
  return { ok: true, matched: true };
}
