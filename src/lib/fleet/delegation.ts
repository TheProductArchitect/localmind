/**
 * Initiator-side wrapper for delegating a task node to a peer.
 *
 * Encapsulates the four-step protocol:
 *
 *   1. Write our local audit row marking the delegation (status = pending)
 *      so the peer can reference it in their cross-reference.
 *   2. sendToPeer(..., "delegate", {...,initiator_audit_id}) — the peer
 *      writes their inbound audit row with a link back to us BEFORE
 *      executing.
 *   3. Receive the signed response, which carries the peer's executor
 *      audit id and signature.
 *   4. logComplete on our side AND record the outbound cross-reference
 *      pointing to the peer's row.
 *
 * After step 4, both sides have:
 *   - their own audit row in their own hash chain
 *   - a fleet_audit_links entry pointing at the other side's row
 *   - the cryptographic signature of the envelope that established the link
 *
 * V6.4 ships this wrapper as a standalone API; V6.5 will plug it into the
 * task graph executor as the peer-runner.
 */

import { sendToPeer } from "./peer-client";
import { logStart, logComplete, linkAuditToPeer } from "../agent/audit-logger";
import type { DelegateRequest, DelegateResponse } from "./handlers/delegate";
import type { AgentSpec, Contract, CostActual } from "../graph/types";
import { computeInputHash } from "../db/task-graphs";

export type DelegationResult =
  | {
      ok: true;
      local_audit_id: number;
      peer_audit_id: number;
      output: unknown;
      output_text?: string;
      cost: CostActual;
    }
  | {
      ok: false;
      local_audit_id: number;
      reason: string;
    };

export async function delegateToPeer(args: {
  peer_node_id: string;
  node_id: string;
  agent_spec: AgentSpec;
  input: Record<string, unknown>;
  contract: Contract;
  parent_outputs?: Record<string, unknown>;
  root_goal: string;
  conversation_id?: string | null;
  timeout_ms?: number;
}): Promise<DelegationResult> {
  // 1. Local audit row written before the RPC. The peer will reference it.
  const localAuditId = logStart({
    actionType: "delegate_to_peer",
    toolName: "fleet_delegate",
    input: {
      peer: args.peer_node_id,
      node_id: args.node_id,
      agent_spec: args.agent_spec,
      root_goal: args.root_goal,
    },
    conversationId: args.conversation_id ?? null,
    approvedBy: "rule",
  });

  // 2. Send the delegate envelope.
  const payload: DelegateRequest = {
    initiator_audit_id: localAuditId,
    node_id: args.node_id,
    agent_spec: args.agent_spec,
    input: args.input,
    input_hash: computeInputHash(args.input, args.agent_spec),
    contract: args.contract,
    parent_outputs: args.parent_outputs,
    root_goal: args.root_goal,
  };

  const result = await sendToPeer<DelegateRequest, DelegateResponse>(
    args.peer_node_id,
    "delegate",
    payload,
    { timeoutMs: args.timeout_ms ?? 30_000 }
  );

  if (!result.ok) {
    logComplete(localAuditId, "failed", `delegate RPC failed: ${result.reason}`);
    return { ok: false, local_audit_id: localAuditId, reason: result.reason };
  }

  // 3. Response verified; record the outbound cross-reference.
  const env = result.envelope;
  const body = env.payload;
  linkAuditToPeer(localAuditId, {
    peer_node_id: args.peer_node_id,
    peer_audit_id: body.executor_audit_id,
    signature: env.sig,
    lamport: env.lamport,
    direction: "outbound",
  });

  // 4. Update our audit row with the outcome summary.
  const summary = body.outcome.ok
    ? typeof body.outcome.output === "string" ? body.outcome.output.slice(0, 800) : JSON.stringify(body.outcome.output ?? "").slice(0, 800)
    : `Peer reported failure: ${body.outcome.error ?? "(no reason)"}`;
  logComplete(localAuditId, body.outcome.ok ? "allowed" : "failed", summary);

  if (!body.outcome.ok) {
    return { ok: false, local_audit_id: localAuditId, reason: body.outcome.error ?? "peer execution failed" };
  }
  return {
    ok: true,
    local_audit_id: localAuditId,
    peer_audit_id: body.executor_audit_id,
    output: body.outcome.output,
    output_text: body.outcome.output_text,
    cost: body.outcome.cost,
  };
}
