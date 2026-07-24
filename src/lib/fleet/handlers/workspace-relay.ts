/**
 * /fleet/workspace-relay — peer asks us to run an allowlisted coding/fs/git op
 * against our local disk (we are the workspace host; they are compute).
 *
 * Security:
 *   - Peer must have accept_workspace_relay in OUR policy_json (default OFF).
 *   - Tool allowlist only: git, coding_project, filesystem (no shell).
 *   - Runs through local tool execute + permission profile; audited.
 */

import { logStartFederated, logComplete } from "../../agent/audit-logger";
import { parsePeerPolicy, getPeer } from "../../db/fleet";
import { getBuiltinTool } from "../../tools";
import type { SignedEnvelope } from "../envelope";
import { runAsWorkspaceRelayInbound } from "../workspace-relay-context";

export const WORKSPACE_RELAY_TOOLS = new Set(["git", "coding_project", "filesystem"]);

export type WorkspaceRelayRequest = {
  initiator_audit_id: number;
  tool: string;
  input: Record<string, unknown>;
  conversation_id?: string | null;
  coding_session_id?: string | null;
};

export type WorkspaceRelayResponse = {
  executor_audit_id: number;
  ok: boolean;
  output: string;
  summary?: string;
  error?: string;
};

export async function handleWorkspaceRelay(args: {
  envelope: SignedEnvelope<WorkspaceRelayRequest>;
  senderNodeId: string;
}): Promise<WorkspaceRelayResponse> {
  const peer = getPeer(args.senderNodeId);
  if (!peer || peer.trusted !== 1) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error: "Peer not trusted.",
    };
  }
  const policy = parsePeerPolicy(peer);
  if (!policy.accept_workspace_relay) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error:
        "This node has not granted workspace-relay to your peer. Enable accept_workspace_relay in the fleet policy.",
    };
  }

  const payload = args.envelope.payload;
  const toolName = String(payload.tool || "");
  if (!WORKSPACE_RELAY_TOOLS.has(toolName)) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error: `Tool "${toolName}" is not allowlisted for workspace relay.`,
    };
  }

  const auditId = logStartFederated(
    {
      actionType: "workspace_relay",
      toolName,
      input: payload.input || {},
      conversationId: payload.conversation_id || null,
      approvedBy: "rule",
    },
    {
      peer_node_id: args.senderNodeId,
      peer_audit_id: payload.initiator_audit_id,
      signature: args.envelope.sig,
      lamport: args.envelope.lamport,
      direction: "inbound",
    }
  );

  const tool = getBuiltinTool(toolName);
  if (!tool) {
    logComplete(auditId, "denied", "unknown tool");
    return { executor_audit_id: auditId, ok: false, output: "", error: "Unknown tool." };
  }

  try {
    const result = await runAsWorkspaceRelayInbound(() =>
      tool.execute(payload.input || {}, {
        conversationId: payload.conversation_id || "workspace-relay",
        approvedDirs: [],
        codingSessionId: payload.coding_session_id || null,
      })
    );
    logComplete(auditId, result.ok ? "allowed" : "denied", (result.summary || result.output || "").slice(0, 200));
    return {
      executor_audit_id: auditId,
      ok: result.ok,
      output: result.output,
      summary: result.summary,
      error: result.ok ? undefined : result.output,
    };
  } catch (e) {
    const msg = (e as Error).message || "workspace relay failed";
    logComplete(auditId, "denied", msg.slice(0, 200));
    return { executor_audit_id: auditId, ok: false, output: "", error: msg };
  }
}
