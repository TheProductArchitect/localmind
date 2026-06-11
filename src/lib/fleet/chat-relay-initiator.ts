/**
 * Initiator-side wrapper for driving a chat session on a peer.
 *
 * Sequence:
 *   1. logStart an audit row on our side ("chat_relay_sent").
 *   2. markOutboundActive so an inbound chat-relay from the same peer in the
 *      same window will refuse — closes the obvious A→B→A loop.
 *   3. sendToPeer the chat-relay envelope.
 *   4. Verify the response, record the cross-reference, complete the audit
 *      row, and surface the assistant text to the caller (the REST endpoint).
 *
 * The actual destructive-floor + permission-profile enforcement happens on
 * the EXECUTOR side — see handlers/chat-relay.ts. This file is purely
 * orchestration: it doesn't decide what the peer is allowed to do.
 */

import { sendToPeer } from "./peer-client";
import { logStart, logComplete, linkAuditToPeer } from "../agent/audit-logger";
import { markOutboundActive, clearOutboundActive } from "./handlers/chat-relay";
import type { ChatRelayRequest, ChatRelayResponse } from "./handlers/chat-relay";

export type RelayChatResult =
  | {
      ok: true;
      local_audit_id: number;
      peer_audit_id: number;
      executor_conversation_id: string;
      reply: string;
    }
  | {
      ok: false;
      local_audit_id: number;
      reason: string;
    };

export async function relayChatToPeer(args: {
  peer_node_id: string;
  /** Our local conversation id. Stable per-thread so the peer can twin it. */
  conversation_id: string;
  message: string;
  persona_id?: string;
  timeout_ms?: number;
}): Promise<RelayChatResult> {
  const localAuditId = logStart({
    actionType: "chat_relay_sent",
    toolName: "fleet_chat_relay",
    input: {
      peer: args.peer_node_id,
      conversation_id: args.conversation_id,
      message_preview: args.message.slice(0, 200),
    },
    conversationId: args.conversation_id,
    approvedBy: "rule",
  });

  markOutboundActive(args.peer_node_id);

  try {
    const payload: ChatRelayRequest = {
      initiator_audit_id: localAuditId,
      initiator_conversation_id: args.conversation_id,
      message: args.message,
      persona_id: args.persona_id,
    };

    const result = await sendToPeer<ChatRelayRequest, ChatRelayResponse>(
      args.peer_node_id,
      "chat-relay",
      payload,
      { timeoutMs: args.timeout_ms ?? 120_000 }
    );

    if (!result.ok) {
      logComplete(localAuditId, "failed", `chat-relay RPC failed: ${result.reason}`);
      return { ok: false, local_audit_id: localAuditId, reason: result.reason };
    }

    const env = result.envelope;
    const body = env.payload;

    if (!body.ok) {
      logComplete(localAuditId, "failed", body.error ?? "peer refused");
      return { ok: false, local_audit_id: localAuditId, reason: body.error ?? "Peer refused the relay." };
    }

    linkAuditToPeer(localAuditId, {
      peer_node_id: args.peer_node_id,
      peer_audit_id: body.executor_audit_id,
      signature: env.sig,
      lamport: env.lamport,
      direction: "outbound",
    });
    logComplete(localAuditId, "allowed", body.reply.slice(0, 800));

    return {
      ok: true,
      local_audit_id: localAuditId,
      peer_audit_id: body.executor_audit_id,
      executor_conversation_id: body.executor_conversation_id,
      reply: body.reply,
    };
  } finally {
    clearOutboundActive(args.peer_node_id);
  }
}
