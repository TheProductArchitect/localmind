/**
 * Conversation sync — keep chat threads identical across paired LAN devices.
 *
 * Model:
 *   - Each conversation has a stable `sync_id` (defaults to local id).
 *   - Each message carries `origin_node_id` + `origin_label` so every device
 *     can show which machine the turn came from.
 *   - Peers with `policy.sync_conversations` exchange deltas: we push our
 *     recent turns and pull theirs. Message ids are preserved — INSERT OR
 *     IGNORE — so sync is idempotent.
 *
 * Security:
 *   - Only trusted, paired peers.
 *   - Opt-out via policy (default ON for personal mesh).
 *   - Payload size capped; no attachments re-hydrated over 256 KiB total.
 */

import { getConvDb } from "../db";
import {
  listPeers,
  parsePeerPolicy,
  getPeer,
  type FleetPeer,
} from "../db/fleet";
import {
  getConversation,
  getMessages,
  type Conversation,
  type Message,
} from "../db/queries";
import { sendToPeer } from "./peer-client";
import { getNodeIdentity } from "./identity";

const MAX_SYNC_MESSAGES = 200;
const MAX_CONTENT_CHARS = 32_000;
/** Total attachment JSON budget per conversation pack (and per message). */
export const MAX_ATTACHMENTS_BYTES = 256 * 1024;
const MAX_ATTACH_ITEMS = 6;
const DEBOUNCE_MS = 1_500;

/**
 * Validate and size-cap message attachments for the sync wire.
 * Only image/* items; drops oversized / malformed payloads.
 */
export function sanitizeAttachmentsForSync(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (Buffer.byteLength(raw, "utf8") > MAX_ATTACHMENTS_BYTES) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const cleaned: { name: string; mime: string; data: string }[] = [];
    for (const item of arr.slice(0, MAX_ATTACH_ITEMS)) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const mime = String(rec.mime || "");
      if (!mime.startsWith("image/")) continue;
      const data = String(rec.data || "");
      if (!data) continue;
      if (Buffer.byteLength(data, "utf8") > MAX_ATTACHMENTS_BYTES) continue;
      cleaned.push({
        name: String(rec.name || "image").slice(0, 200),
        mime,
        data,
      });
    }
    if (cleaned.length === 0) return null;
    const out = JSON.stringify(cleaned);
    if (Buffer.byteLength(out, "utf8") > MAX_ATTACHMENTS_BYTES) return null;
    return out;
  } catch {
    return null;
  }
}

export type SyncMessage = {
  id: string;
  role: Message["role"];
  content: string;
  created_at: number;
  token_count: number;
  parent_message_id: string | null;
  attachments?: string | null;
  origin_node_id: string | null;
  origin_label: string | null;
};

export type SyncConversation = {
  sync_id: string;
  title: string;
  updated_at: number;
  origin_node_id: string | null;
  messages: SyncMessage[];
};

export type ConversationSyncRequest = {
  /** Pull everything updated after this cursor (ms). 0 = full recent window. */
  since_ms: number;
  /** Optional push of our local deltas. */
  push?: SyncConversation[];
};

export type ConversationSyncResponse = {
  ok: boolean;
  conversations: SyncConversation[];
  cursor_ms: number;
  error?: string;
};

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced fan-out after local writes. */
export function scheduleConversationSync(conversationId: string): void {
  pending.add(conversationId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const ids = [...pending];
    pending.clear();
    void pushConversationsToPeers(ids).catch(() => { /* non-fatal */ });
  }, DEBOUNCE_MS);
  if (typeof flushTimer === "object" && flushTimer && "unref" in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref?.();
  }
}

function syncPeers(): FleetPeer[] {
  return listPeers().filter((p) => p.trusted === 1 && parsePeerPolicy(p).sync_conversations);
}

function packConversation(conv: Conversation, sinceMs: number): SyncConversation | null {
  const syncId = conv.sync_id || conv.id;
  let attachBudget = MAX_ATTACHMENTS_BYTES;
  const msgs = getMessages(conv.id)
    .filter((m) => m.created_at >= sinceMs)
    .slice(-MAX_SYNC_MESSAGES)
    .map((m): SyncMessage => {
      let attachments: string | null = null;
      const sanitized = sanitizeAttachmentsForSync(m.attachments);
      if (sanitized) {
        const n = Buffer.byteLength(sanitized, "utf8");
        if (n <= attachBudget) {
          attachBudget -= n;
          attachments = sanitized;
        }
      }
      return {
        id: m.id,
        role: m.role,
        content: m.content.slice(0, MAX_CONTENT_CHARS),
        created_at: m.created_at,
        token_count: m.token_count,
        parent_message_id: m.parent_message_id,
        attachments,
        origin_node_id: m.origin_node_id ?? null,
        origin_label: m.origin_label ?? null,
      };
    });
  if (msgs.length === 0 && conv.updated_at < sinceMs) return null;
  return {
    sync_id: syncId,
    title: conv.title,
    updated_at: conv.updated_at,
    origin_node_id: conv.origin_node_id ?? null,
    messages: msgs,
  };
}

function findBySyncId(syncId: string): Conversation | null {
  return (
    (getConvDb()
      .prepare("SELECT * FROM conversations WHERE sync_id=? AND deleted_at IS NULL LIMIT 1")
      .get(syncId) as Conversation | undefined) ?? null
  );
}

/** Apply a peer's conversation bundle into the local DB. Idempotent. */
export function applySyncedConversations(
  bundles: SyncConversation[],
  fromPeerLabel?: string
): { conversations: number; messages: number } {
  const db = getConvDb();
  let convCount = 0;
  let msgCount = 0;
  const localNode = (() => {
    try { return getNodeIdentity().node_id; } catch { return null; }
  })();

  const tx = db.transaction(() => {
    for (const b of bundles) {
      if (!b?.sync_id) continue;
      let conv = findBySyncId(b.sync_id);
      if (!conv) {
        const id = b.sync_id; // reuse sync_id as local id for first landing
        const now = Date.now();
        db.prepare(
          `INSERT INTO conversations
             (id, title, created_at, updated_at, starred, deleted_at, tags, profile_id, owner_user_id, sync_id, origin_node_id)
           VALUES (?,?,?,?,0,NULL,'[]',NULL,NULL,?,?)`
        ).run(
          id,
          b.title || "Synced conversation",
          Math.min(...(b.messages.map((m) => m.created_at).concat([now]))),
          b.updated_at || now,
          b.sync_id,
          b.origin_node_id
        );
        conv = getConversation(id);
        convCount++;
      } else if (b.title && b.title !== conv.title && (b.updated_at || 0) >= conv.updated_at) {
        db.prepare("UPDATE conversations SET title=?, updated_at=? WHERE id=?").run(
          b.title, Math.max(b.updated_at, conv.updated_at), conv.id
        );
      }
      if (!conv) continue;

      const insert = db.prepare(
        `INSERT OR IGNORE INTO messages
           (id, conversation_id, role, content, created_at, token_count, parent_message_id, attachments, origin_node_id, origin_label)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      );
      for (const m of b.messages || []) {
        if (!m?.id || !m.role) continue;
        const label =
          m.origin_label ||
          (m.origin_node_id && m.origin_node_id !== localNode ? fromPeerLabel : null) ||
          null;
        const r = insert.run(
          m.id,
          conv.id,
          m.role,
          (m.content || "").slice(0, MAX_CONTENT_CHARS),
          m.created_at || Date.now(),
          m.token_count || 0,
          m.parent_message_id ?? null,
          sanitizeAttachmentsForSync(m.attachments),
          m.origin_node_id ?? null,
          label
        );
        if (r.changes > 0) msgCount++;
      }
      if ((b.messages || []).length) {
        const maxAt = Math.max(conv.updated_at, b.updated_at, ...b.messages.map((m) => m.created_at));
        db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(maxAt, conv.id);
      }
    }
  });
  tx();
  return { conversations: convCount, messages: msgCount };
}

/** Build our outbound push payload for the given conversation ids. */
export function buildPushPayload(conversationIds: string[], sinceMs = 0): SyncConversation[] {
  const out: SyncConversation[] = [];
  for (const id of conversationIds) {
    const conv = getConversation(id);
    if (!conv || conv.deleted_at) continue;
    const packed = packConversation(conv, sinceMs);
    if (packed) out.push(packed);
  }
  return out;
}

/** Recent conversations for a full pull response. */
export function buildPullPayload(sinceMs: number): SyncConversation[] {
  const rows = getConvDb()
    .prepare(
      "SELECT * FROM conversations WHERE deleted_at IS NULL AND updated_at >= ? ORDER BY updated_at DESC LIMIT 50"
    )
    .all(sinceMs) as Conversation[];
  const out: SyncConversation[] = [];
  for (const c of rows) {
    const packed = packConversation(c, sinceMs);
    if (packed) out.push(packed);
  }
  return out;
}

export async function pushConversationsToPeers(conversationIds: string[]): Promise<void> {
  const peers = syncPeers();
  if (peers.length === 0 || conversationIds.length === 0) return;
  const push = buildPushPayload(conversationIds, 0);
  if (push.length === 0) return;

  await Promise.all(
    peers.map(async (peer) => {
      await sendToPeer<ConversationSyncRequest, ConversationSyncResponse>(
        peer.peer_node_id,
        "conversation-sync",
        { since_ms: 0, push },
        { timeoutMs: 15_000 }
      );
    })
  );
}

/** Pull from all sync-enabled peers and merge. Returns total new messages. */
export async function pullConversationsFromPeers(sinceMs?: number): Promise<{ peers: number; messages: number }> {
  const peers = syncPeers();
  let messages = 0;
  const since = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  await Promise.all(
    peers.map(async (peer) => {
      const r = await sendToPeer<ConversationSyncRequest, ConversationSyncResponse>(
        peer.peer_node_id,
        "conversation-sync",
        { since_ms: since },
        { timeoutMs: 20_000 }
      );
      if (!r.ok || !r.envelope.payload?.ok) return;
      const applied = applySyncedConversations(
        r.envelope.payload.conversations || [],
        peer.label || peer.peer_node_id.slice(0, 12)
      );
      messages += applied.messages;
    })
  );
  return { peers: peers.length, messages };
}

/** Inbound handler body. */
export async function handleConversationSync(args: {
  envelope_sender: string;
  payload: ConversationSyncRequest;
}): Promise<ConversationSyncResponse> {
  const peer = getPeer(args.envelope_sender);
  if (!peer || peer.trusted !== 1) {
    return { ok: false, conversations: [], cursor_ms: Date.now(), error: "Peer not trusted." };
  }
  const policy = parsePeerPolicy(peer);
  if (!policy.sync_conversations) {
    return { ok: false, conversations: [], cursor_ms: Date.now(), error: "Conversation sync disabled for this peer." };
  }

  if (args.payload.push?.length) {
    applySyncedConversations(args.payload.push, peer.label || peer.peer_node_id.slice(0, 12));
  }

  const since = Math.max(0, Number(args.payload.since_ms) || 0);
  const conversations = buildPullPayload(since);
  return { ok: true, conversations, cursor_ms: Date.now() };
}
