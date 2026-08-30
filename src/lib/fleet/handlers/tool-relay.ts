/**
 * /fleet/tool-relay — a peer running the LLM/agent elsewhere (e.g. a DGX hub)
 * asks us to run an allowlisted personal-assistant tool on OUR device.
 *
 * Use case: the user chats with Sora whose model runs on the Spark, but wants
 * "read my calendar" / "open this file" / "send this email" to act on their
 * own PC. The Spark is the compute EXECUTOR; this device is the INITIATOR and
 * the tool HOME.
 *
 * Security (defense in depth):
 *   - mTLS + signed envelope + peer.trusted (checked in server.ts dispatcher).
 *   - Peer must have `accept_tool_relay` in OUR policy_json (default OFF).
 *   - Tool allowlist only — device/account tools, never `shell`.
 *   - Bound to an in-flight outbound chat-relay to that peer (prevents unbound
 *     tool RPCs that would bypass the executor's ask/pin gate).
 *   - Local classify(): ask/pin actions still require a pending local
 *     confirmation (or are denied if none can be shown).
 *   - Audited as an inbound federated row with the initiator cross-reference.
 */

import { logStartFederated, logComplete } from "../../agent/audit-logger";
import { parsePeerPolicy, getPeer } from "../../db/fleet";
import { getBuiltinTool } from "../../tools";
import type { SignedEnvelope } from "../envelope";
import { runAsToolRelayInbound } from "../tool-relay-context";
import { isOutboundActive } from "./chat-relay";

/**
 * Personal-assistant tools that make sense to run on the user's own device.
 * Deliberately excludes `shell` and the coding/git/workspace set (that has its
 * own workspace-relay path) plus network-neutral web tools (which are better
 * left on the hub's connection).
 */
export const TOOL_RELAY_TOOLS = new Set([
  "filesystem",
  "calendar",
  "email",
  "reminders",
  "contacts",
  "browser",
  "browse_session",
  "mac_automation",
]);

export type ToolRelayRequest = {
  initiator_audit_id: number;
  tool: string;
  input: Record<string, unknown>;
  conversation_id?: string | null;
};

export type ToolRelayResponse = {
  executor_audit_id: number;
  ok: boolean;
  output: string;
  summary?: string;
  error?: string;
};

export async function handleToolRelay(args: {
  envelope: SignedEnvelope<ToolRelayRequest>;
  senderNodeId: string;
}): Promise<ToolRelayResponse> {
  const peer = getPeer(args.senderNodeId);
  if (!peer || peer.trusted !== 1) {
    return { executor_audit_id: 0, ok: false, output: "", error: "Peer not trusted." };
  }
  const policy = parsePeerPolicy(peer);
  if (!policy.accept_tool_relay) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error:
        "This device has not granted tool-relay to your peer. Enable 'Accept tool relay' in the fleet policy for it.",
    };
  }

  // Tool-home RPCs are only valid while we are driving a chat on that peer —
  // otherwise a trusted peer could POST tool-relay unbound and skip the
  // executor's ask/pin confirmation.
  if (!isOutboundActive(args.senderNodeId)) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error:
        "Tool relay refused: no active chat-relay to this peer. Open a turn with Tools on this device first.",
    };
  }

  const payload = args.envelope.payload;
  const toolName = String(payload.tool || "");
  if (!TOOL_RELAY_TOOLS.has(toolName)) {
    return {
      executor_audit_id: 0,
      ok: false,
      output: "",
      error: `Tool "${toolName}" is not allowlisted for tool relay.`,
    };
  }

  const tool = getBuiltinTool(toolName);
  if (!tool) {
    return { executor_audit_id: 0, ok: false, output: "", error: "Unknown tool on this device." };
  }

  const input = payload.input || {};

  const auditId = logStartFederated(
    {
      actionType: "tool_relay",
      toolName,
      input,
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

  try {
    const { getSettings } = await import("../../db/queries");
    let approvedDirs: string[] = [];
    try {
      approvedDirs = JSON.parse(getSettings().approved_dirs || "[]");
    } catch {
      /* default to none */
    }
    const result = await runAsToolRelayInbound(() =>
      tool.execute(input, {
        conversationId: payload.conversation_id || "tool-relay",
        approvedDirs,
        codingSessionId: null,
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
    const msg = (e as Error).message || "tool relay failed";
    logComplete(auditId, "denied", msg.slice(0, 200));
    return { executor_audit_id: auditId, ok: false, output: "", error: msg };
  }
}
