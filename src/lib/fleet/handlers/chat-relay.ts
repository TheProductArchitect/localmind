/**
 * /fleet/chat-relay — peer is driving a CHAT session on this node.
 *
 * Use case: the user is at the keyboard of their Mac but wants to talk to the
 * Sora running on their DGX Spark, with full access to that machine's tools,
 * files, and memory. The Mac is the INITIATOR; the Spark is the EXECUTOR.
 *
 * Contract (executor side — that's us in this file):
 *
 *   1. Verify envelope (the dispatcher in server.ts already did this — the
 *      envelope is signed and the peer is paired + trusted).
 *   2. Capability check — the peer must have `accept_chat_relay: true` in
 *      OUR policy_json for it. Default is OFF; the user must explicitly opt
 *      in per peer ("yes, I trust the Mac to drive this Spark").
 *   3. Rate limit — per-peer sliding-window counter, default 30/min, prevents
 *      a compromised peer from flooding our model with junk.
 *   4. Payload size cap — message body capped at 64 KiB.
 *   5. Loop guard — if WE are currently driving a chat on this peer, refuse
 *      its inbound request. Prevents an A→B→A bounce that exhausts both
 *      models on the same prompt.
 *   6. Conversation continuity — each (peer, initiator_conversation_id) pair
 *      maps to a local conversation row tagged `relayed_from:<peerNodeId>`.
 *      The peer's UI is the user-facing thread; OUR row is the executor-side
 *      twin that holds the full audit trail.
 *   7. Run through runAgentCollect with the LOCAL agent_mode + permission
 *      profile — the destructive-action floor still applies. A peer that
 *      tries to make us `rm -rf /` will trip the same `ask` gate as a local
 *      user. (UI-side approval propagation is a Phase-2 follow-up; for now
 *      destructive ops will simply fail-closed with a clear message.)
 *   8. Audit row tagged with peer_audit_id cross-reference (logStartFederated)
 *      so both sides can independently prove what was asked + executed.
 *
 * Defense-in-depth notes:
 *   - mTLS at transport: peers prove cert ownership before bytes flow.
 *   - Envelope signature: every payload is Ed25519-signed.
 *   - Peer trust flag: peer.trusted=0 short-circuits in server.ts.
 *   - Capability gate: this file. User must opt in.
 *   - Rate limit: this file. Per-peer.
 *   - Permission profile: applied during runAgentCollect inside the engine.
 *   - Destructive floor: cannot be bypassed by any peer, ever (the floor
 *     is hard-coded in permission-guard.ts).
 *   - Audit trail: bilateral, cross-referenced, signed.
 */

import { logStartFederated, logComplete } from "../../agent/audit-logger";
import { createConversation, getConversation } from "../../db/queries";
import { parsePeerPolicy } from "../../db/fleet";
import { getConvDb } from "../../db";
import { getPeer } from "../../db/fleet";
import type { SignedEnvelope } from "../envelope";

export type ChatRelayRequest = {
  /** Initiator-side audit id — we record it as the peer_audit_id cross-ref. */
  initiator_audit_id: number;
  /** Initiator's conversation id, used as a stable thread key on our side. */
  initiator_conversation_id: string;
  /** The user's message text. Capped at MAX_MESSAGE_BYTES. */
  message: string;
  /** Optional persona id to run as. Defaults to "persona-general". */
  persona_id?: string;
  /** When true, executor may emit token chunks via onToken (fleet NDJSON stream). */
  stream_tokens?: boolean;
};

export type ChatRelayResponse = {
  executor_audit_id: number;
  executor_conversation_id: string;
  reply: string;
  ok: boolean;
  /** Reason string when ok=false — surfaced to the initiator's user. */
  error?: string;
};

const MAX_MESSAGE_BYTES = 64 * 1024;

// In-memory rate-limit state. Restarts reset it — that's fine; the limit is
// to defend against a runaway peer, not to enforce a billable quota.
const inboundCounters = new Map<string, { count: number; windowStart: number }>();
// Tracks peers we are CURRENTLY driving outbound, so we can detect loops.
const outboundActivePeers = new Set<string>();
const RATE_WINDOW_MS = 60_000;

/** Test-only: lets unit tests assert empty starting state and reset between cases. */
export function __resetChatRelayState(): void {
  inboundCounters.clear();
  outboundActivePeers.clear();
}

/** Called by the initiator path to mark a peer as "currently being driven by us". */
export function markOutboundActive(peerNodeId: string): void {
  outboundActivePeers.add(peerNodeId);
}
export function clearOutboundActive(peerNodeId: string): void {
  outboundActivePeers.delete(peerNodeId);
}

/**
 * "Established" peers — ones we've been paired with for a while and that are
 * actively on the network right now — bypass the rate limit. Brand-new or
 * long-idle peers get the configured cap (and idle reconnect is tightened
 * further since a long-quiet device suddenly waking up is the textbook
 * compromised-machine pattern).
 *
 * Heuristic boundaries (intentionally simple — no ML, no scoring; the user
 * can tune them per-peer via policy_json):
 *
 *   ESTABLISHED   paired > 7d  AND  last_seen ≤ 6h        → no rate limit
 *   ACTIVE        paired > 24h AND  last_seen ≤ 24h       → 2× cap
 *   NEW           paired ≤ 24h                            → 1× cap (default 30/min)
 *   IDLE-RECONNECT last_seen > 24h ago                    → 0.3× cap (cooldown)
 */
export type PeerTrustClass = "established" | "active" | "new" | "idle-reconnect";

export function classifyPeerTrust(peer: { paired_at: number; last_seen_at: number | null }): PeerTrustClass {
  const now = Date.now();
  const pairedAgeMs = now - peer.paired_at;
  const seenAgeMs = peer.last_seen_at == null ? Infinity : now - peer.last_seen_at;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  if (seenAgeMs > DAY) return "idle-reconnect";
  if (pairedAgeMs > WEEK && seenAgeMs <= 6 * HOUR) return "established";
  if (pairedAgeMs > DAY && seenAgeMs <= DAY) return "active";
  return "new";
}

function bumpInbound(peerNodeId: string): { ok: true } | { ok: false; reason: string } {
  const peer = getPeer(peerNodeId);
  if (!peer) return { ok: false, reason: "Unknown peer" };

  const trust = classifyPeerTrust(peer);

  // Established peers bypass the rate limit entirely — they're long-paired
  // AND currently on the network, exactly the user's "always connected"
  // scenario.
  if (trust === "established") return { ok: true };

  const baseCap = parsePeerPolicy(peer).chat_relay_rate_per_min;
  let effectiveCap = baseCap;
  if (trust === "active") effectiveCap = baseCap * 2;
  else if (trust === "idle-reconnect") effectiveCap = Math.max(1, Math.floor(baseCap * 0.3));

  const now = Date.now();
  const entry = inboundCounters.get(peerNodeId);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    inboundCounters.set(peerNodeId, { count: 1, windowStart: now });
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > effectiveCap) {
    return {
      ok: false,
      reason: `Rate limit exceeded — ${effectiveCap}/min for ${trust} peer (base ${baseCap}/min, trust class '${trust}').`,
    };
  }
  return { ok: true };
}

/**
 * Resolve (or create) the local conversation row that twins the initiator's
 * thread. We tag it so the user can spot federated threads in /work, and so
 * subsequent turns continue against the same context window instead of
 * spawning a new conversation each time.
 */
function getOrCreateRelayedConversation(args: {
  peerNodeId: string;
  initiatorConversationId: string;
}): string {
  const tagMarker = `relayed_from:${args.peerNodeId}:${args.initiatorConversationId}`;
  const existing = getConvDb()
    .prepare("SELECT id FROM conversations WHERE tags LIKE ? AND deleted_at IS NULL LIMIT 1")
    .get(`%${tagMarker}%`) as { id: string } | undefined;
  if (existing) return existing.id;

  const conv = createConversation(undefined, undefined);
  const row = getConvDb()
    .prepare("SELECT tags FROM conversations WHERE id=?")
    .get(conv.id) as { tags: string };
  const tags = (() => {
    try { return JSON.parse(row.tags || "[]") as string[]; } catch { return []; }
  })();
  tags.push(tagMarker);
  getConvDb()
    .prepare("UPDATE conversations SET tags=? WHERE id=?")
    .run(JSON.stringify(tags), conv.id);
  return conv.id;
}

export async function handleChatRelay(args: {
  envelope: SignedEnvelope<unknown>;
  senderNodeId: string;
  /** When set, text deltas are forwarded as they arrive (fleet NDJSON stream). */
  onToken?: (text: string) => void | Promise<void>;
}): Promise<ChatRelayResponse> {
  const peerNodeId = args.senderNodeId;
  const peer = getPeer(peerNodeId);
  if (!peer) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: "Unknown peer — pair first.",
    };
  }

  // (1) Capability gate. Default-deny.
  const policy = parsePeerPolicy(peer);
  if (!policy.accept_chat_relay) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: "This node has not granted chat-relay to your peer. Enable accept_chat_relay in the fleet policy.",
    };
  }

  // (2) Loop guard.
  if (outboundActivePeers.has(peerNodeId)) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: "Loop refused: we are already driving a chat on this peer; declining the inbound to prevent a model bounce.",
    };
  }

  // (3) Smart rate limit. Established peers bypass; new/idle peers tighter.
  const rateCheck = bumpInbound(peerNodeId);
  if (!rateCheck.ok) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: rateCheck.reason,
    };
  }

  const payload = args.envelope.payload as ChatRelayRequest;

  // (4) Payload validation.
  if (!payload || typeof payload.message !== "string" || !payload.message.trim()) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: "Empty message.",
    };
  }
  if (Buffer.byteLength(payload.message, "utf8") > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: `Message exceeds ${MAX_MESSAGE_BYTES} bytes.`,
    };
  }
  if (!payload.initiator_conversation_id || typeof payload.initiator_conversation_id !== "string") {
    return {
      ok: false,
      executor_audit_id: 0,
      executor_conversation_id: "",
      reply: "",
      error: "initiator_conversation_id is required.",
    };
  }

  // (5) Audit row BEFORE execution, with cross-reference to the initiator's row.
  const auditId = logStartFederated(
    {
      actionType: "chat_relay_executed",
      toolName: "fleet_chat_relay",
      input: {
        from_peer: peerNodeId,
        initiator_conversation_id: payload.initiator_conversation_id,
        message_preview: payload.message.slice(0, 200),
      },
      conversationId: null,
      approvedBy: "rule",
    },
    {
      peer_node_id: peerNodeId,
      peer_audit_id: payload.initiator_audit_id,
      signature: args.envelope.sig,
      lamport: args.envelope.lamport,
      direction: "inbound",
    }
  );

  // (6) Find or create the twin conversation.
  const convId = getOrCreateRelayedConversation({
    peerNodeId,
    initiatorConversationId: payload.initiator_conversation_id,
  });
  if (!getConversation(convId)) {
    logComplete(auditId, "failed", "twin conversation could not be created");
    return {
      ok: false,
      executor_audit_id: auditId,
      executor_conversation_id: "",
      reply: "",
      error: "Could not establish twin conversation.",
    };
  }

  // (7) Run through the local engine. Dynamic import to avoid the engine
  //     pulling in tools/subagent and circling back through fleet during
  //     module init. The engine uses runAgentCollect which honours the
  //     LOCAL permission profile + destructive floor + sanitizer — those
  //     are universally enforced, peers cannot bypass them.
  //     When onToken is provided (streaming fleet path), use runAgent and
  //     forward text deltas so the initiator can render live tokens.
  let reply = "";
  try {
    if (args.onToken) {
      const { runAgent } = await import("../../agent/engine");
      const controller = new AbortController();
      for await (const ev of runAgent(convId, payload.message, controller.signal, {
        processDisplayName: `Chat from peer ${peer.label || peerNodeId.slice(0, 8)}`,
        processMetadata: {
          kind: "chat_relay_inbound",
          peer_node_id: peerNodeId,
          initiator_conversation_id: payload.initiator_conversation_id,
          initiator_audit_id: payload.initiator_audit_id,
        },
      })) {
        if (ev.type === "text_chunk" && typeof (ev as { delta?: string }).delta === "string") {
          const delta = (ev as { delta: string }).delta;
          if (delta) {
            reply += delta;
            await args.onToken(delta);
          }
        }
      }
    } else {
      const { runAgentCollect } = await import("../../agent/engine");
      reply = await runAgentCollect(convId, payload.message, {
        processDisplayName: `Chat from peer ${peer.label || peerNodeId.slice(0, 8)}`,
        processMetadata: {
          kind: "chat_relay_inbound",
          peer_node_id: peerNodeId,
          initiator_conversation_id: payload.initiator_conversation_id,
          initiator_audit_id: payload.initiator_audit_id,
        },
      });
    }
  } catch (e) {
    const msg = (e as Error).message ?? "engine threw";
    logComplete(auditId, "failed", msg);
    return {
      ok: false,
      executor_audit_id: auditId,
      executor_conversation_id: convId,
      reply: "",
      error: msg,
    };
  }

  logComplete(auditId, "allowed", reply.slice(0, 800));
  return {
    ok: true,
    executor_audit_id: auditId,
    executor_conversation_id: convId,
    reply,
  };
}
