/**
 * Executor-side wrapper: run an allowlisted personal-assistant tool back on the
 * initiator's device (tool home = initiator). Mirrors workspace-relay-initiator.
 */

import { sendToPeer } from "./peer-client";
import { logStart, logComplete, linkAuditToPeer } from "../agent/audit-logger";
import type { ToolRelayRequest, ToolRelayResponse } from "./handlers/tool-relay";

export type RelayToolResult =
  | { ok: true; local_audit_id: number; peer_audit_id: number; output: string; summary?: string }
  | { ok: false; local_audit_id: number; reason: string; output?: string };

export async function relayToolToPeer(args: {
  peer_node_id: string;
  tool: string;
  input: Record<string, unknown>;
  conversation_id?: string | null;
  timeout_ms?: number;
}): Promise<RelayToolResult> {
  const localAuditId = logStart({
    actionType: "tool_relay_sent",
    toolName: args.tool,
    input: {
      peer: args.peer_node_id,
      tool: args.tool,
      preview: JSON.stringify(args.input).slice(0, 400),
    },
    conversationId: args.conversation_id || null,
    approvedBy: "rule",
  });

  try {
    const payload: ToolRelayRequest = {
      initiator_audit_id: localAuditId,
      tool: args.tool,
      input: args.input,
      conversation_id: args.conversation_id ?? null,
    };

    const result = await sendToPeer<ToolRelayRequest, ToolRelayResponse>(
      args.peer_node_id,
      "tool-relay",
      payload,
      { timeoutMs: args.timeout_ms ?? 120_000 }
    );

    if (!result.ok) {
      logComplete(localAuditId, "failed", `tool-relay RPC failed: ${result.reason}`);
      return { ok: false, local_audit_id: localAuditId, reason: result.reason };
    }

    const env = result.envelope;
    const body = env.payload;
    if (!body.ok) {
      const reason = body.error || body.output || "Peer refused tool relay.";
      logComplete(localAuditId, "failed", reason.slice(0, 400));
      return { ok: false, local_audit_id: localAuditId, reason, output: body.output };
    }

    linkAuditToPeer(localAuditId, {
      peer_node_id: args.peer_node_id,
      peer_audit_id: body.executor_audit_id,
      signature: env.sig,
      lamport: env.lamport,
      direction: "outbound",
    });
    logComplete(localAuditId, "allowed", (body.summary || body.output || "").slice(0, 400));
    return {
      ok: true,
      local_audit_id: localAuditId,
      peer_audit_id: body.executor_audit_id,
      output: body.output,
      summary: body.summary,
    };
  } catch (e) {
    const msg = (e as Error).message || "tool relay threw";
    logComplete(localAuditId, "failed", msg.slice(0, 200));
    return { ok: false, local_audit_id: localAuditId, reason: msg };
  }
}
