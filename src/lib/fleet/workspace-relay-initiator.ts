/**
 * Initiator-side workspace-relay — run allowlisted coding/fs/git ops on a peer.
 */

import { sendToPeer } from "./peer-client";
import { logStart, logComplete, linkAuditToPeer } from "../agent/audit-logger";
import type {
  WorkspaceRelayRequest,
  WorkspaceRelayResponse,
} from "./handlers/workspace-relay";

export type RelayWorkspaceResult =
  | {
      ok: true;
      local_audit_id: number;
      peer_audit_id: number;
      output: string;
      summary?: string;
    }
  | {
      ok: false;
      local_audit_id: number;
      reason: string;
      output?: string;
    };

export async function relayWorkspaceToolToPeer(args: {
  peer_node_id: string;
  tool: string;
  input: Record<string, unknown>;
  conversation_id?: string | null;
  coding_session_id?: string | null;
  timeout_ms?: number;
}): Promise<RelayWorkspaceResult> {
  const localAuditId = logStart({
    actionType: "workspace_relay_sent",
    toolName: args.tool,
    input: {
      peer: args.peer_node_id,
      tool: args.tool,
      coding_session_id: args.coding_session_id ?? null,
      preview: JSON.stringify(args.input).slice(0, 400),
    },
    conversationId: args.conversation_id || null,
    approvedBy: "rule",
  });

  try {
    const payload: WorkspaceRelayRequest = {
      initiator_audit_id: localAuditId,
      tool: args.tool,
      input: args.input,
      conversation_id: args.conversation_id ?? null,
      coding_session_id: args.coding_session_id ?? null,
    };

    const result = await sendToPeer<WorkspaceRelayRequest, WorkspaceRelayResponse>(
      args.peer_node_id,
      "workspace-relay",
      payload,
      { timeoutMs: args.timeout_ms ?? 120_000 }
    );

    if (!result.ok) {
      logComplete(localAuditId, "failed", `workspace-relay RPC failed: ${result.reason}`);
      return { ok: false, local_audit_id: localAuditId, reason: result.reason };
    }

    const env = result.envelope;
    const body = env.payload;

    if (!body.ok) {
      const reason = body.error || body.output || "Peer refused workspace relay.";
      logComplete(localAuditId, "failed", reason.slice(0, 400));
      return {
        ok: false,
        local_audit_id: localAuditId,
        reason,
        output: body.output,
      };
    }

    linkAuditToPeer(localAuditId, {
      peer_node_id: args.peer_node_id,
      peer_audit_id: body.executor_audit_id,
      signature: env.sig,
      lamport: env.lamport,
      direction: "outbound",
    });
    logComplete(localAuditId, "allowed", (body.summary || body.output || "").slice(0, 800));

    return {
      ok: true,
      local_audit_id: localAuditId,
      peer_audit_id: body.executor_audit_id,
      output: body.output,
      summary: body.summary,
    };
  } catch (e) {
    const msg = (e as Error).message || "workspace relay failed";
    logComplete(localAuditId, "failed", msg.slice(0, 400));
    return { ok: false, local_audit_id: localAuditId, reason: msg };
  }
}
