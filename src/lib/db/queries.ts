import { nanoid } from "nanoid";
import { getConfigDb, getConvDb } from ".";

// ---------------- Settings ----------------
export type Settings = {
  assistant_name: string;
  personality: string;
  theme: string;
  locale: string;
  active_profile_id: string;
  pin_hash: string | null;
  provider: string;
  active_model: string | null;
  lan_enabled: number;
  port: number;
  https_enabled: number;
  approved_dirs: string;
  onboarded: number;
  chat_font_size: number;
  auto_backup: number;
  backup_dir: string | null;
  require_login: number;
  guest_mode: number;
  devpm_model: string | null;
  tts_voice: string | null;
  auto_capture: number;
  api_token_hash: string | null;
  context_window: number;
  agent_mode: AgentMode;
  web_access_killed: number;
  web_search_provider: WebSearchProvider;
  idle_work_enabled: number;
  idle_start_hour: number;
  idle_end_hour: number;
  /** Chat/SWE compute placement: local | auto | peer_node_id */
  compute_placement?: string;
  /** Repo/worktree host: local | peer_node_id */
  workspace_placement?: string;
  /** When 1, coding window prefers code-server URL over /projects */
  code_server_enabled?: number;
  /** Local code-server base URL (default http://127.0.0.1:8080) */
  code_server_url?: string;
};

export type WebSearchProvider = "auto" | "brave" | "you" | "duckduckgo";

export type AgentMode = "auto" | "plan" | "ask";

export function getSettings(): Settings {
  return getConfigDb().prepare("SELECT * FROM settings WHERE id=1").get() as Settings;
}

export function updateSettings(patch: Partial<Settings>) {
  const db = getConfigDb();
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  db.prepare(`UPDATE settings SET ${set} WHERE id=1`).run(patch as any);
}

// ---------------- Permission Profiles ----------------
export type PermissionTier = "allow" | "ask" | "pin";
export type PermissionTiers = Record<string, PermissionTier>;
export type PermissionProfile = {
  id: string;
  name: string;
  tiers: PermissionTiers;
  builtin: number;
  created_at: number;
};

export function listProfiles(): PermissionProfile[] {
  const rows = getConfigDb()
    .prepare("SELECT * FROM permission_profiles ORDER BY builtin DESC, created_at")
    .all() as any[];
  return rows.map((r) => ({ ...r, tiers: JSON.parse(r.tiers) }));
}

export function getProfile(id: string): PermissionProfile | null {
  const r = getConfigDb()
    .prepare("SELECT * FROM permission_profiles WHERE id=?")
    .get(id) as any;
  if (!r) return null;
  return { ...r, tiers: JSON.parse(r.tiers) };
}

export function getActiveProfile(): PermissionProfile {
  const s = getSettings();
  const p = getProfile(s.active_profile_id) || getProfile("normal");
  if (!p) throw new Error("No permission profile found");
  return p;
}

export function updateProfileTiers(id: string, tiers: PermissionTiers) {
  getConfigDb()
    .prepare("UPDATE permission_profiles SET tiers=? WHERE id=?")
    .run(JSON.stringify(tiers), id);
}

export function createProfile(name: string, tiers: PermissionTiers): PermissionProfile {
  const id = nanoid(10);
  getConfigDb()
    .prepare(
      "INSERT INTO permission_profiles (id, name, tiers, builtin, created_at) VALUES (?,?,?,0,?)"
    )
    .run(id, name, JSON.stringify(tiers), Date.now());
  return getProfile(id)!;
}

// ---------------- Memory ----------------
export type MemoryItem = {
  id: string;
  key: string;
  value: string;
  created_at: number;
  updated_at: number;
  source_conversation_id: string | null;
  user_id: string | null;
};

// Pass a userId to scope to that user; omit to read all (agent system prompt).
export function listMemory(userId?: string): MemoryItem[] {
  const db = getConfigDb();
  if (userId) {
    // Include unowned (user_id IS NULL) memory — the memory tool writes with the
    // conversation's owner, which is null on single-operator/localhost setups.
    // Without this, memory Sora saves never shows for the logged-in owner.
    return db
      .prepare("SELECT * FROM memory WHERE user_id IS NULL OR user_id=? ORDER BY created_at")
      .all(userId) as MemoryItem[];
  }
  return db.prepare("SELECT * FROM memory ORDER BY created_at").all() as MemoryItem[];
}

export function upsertMemory(key: string, value: string, convId?: string, userId?: string): MemoryItem {
  const db = getConfigDb();
  const existing = db
    .prepare("SELECT * FROM memory WHERE key=? AND (user_id IS ? OR user_id=?)")
    .get(key, userId ?? null, userId ?? null) as MemoryItem | undefined;
  const now = Date.now();
  if (existing) {
    db.prepare("UPDATE memory SET value=?, updated_at=? WHERE id=?").run(value, now, existing.id);
    return { ...existing, value, updated_at: now };
  }
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO memory (id, key, value, created_at, updated_at, source_conversation_id, user_id) VALUES (?,?,?,?,?,?,?)"
  ).run(id, key, value, now, now, convId ?? null, userId ?? null);
  return { id, key, value, created_at: now, updated_at: now, source_conversation_id: convId ?? null, user_id: userId ?? null };
}

export function getMemory(id: string): MemoryItem | null {
  return (getConfigDb().prepare("SELECT * FROM memory WHERE id=?").get(id) as MemoryItem) || null;
}

export function deleteMemory(id: string) {
  getConfigDb().prepare("DELETE FROM memory WHERE id=?").run(id);
}

// ---------------- Conversations ----------------
export type Conversation = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  starred: number;
  deleted_at: number | null;
  tags: string;
  profile_id: string | null;
  owner_user_id: string | null;
  /** Stable id shared across fleet peers for the same logical thread. */
  sync_id?: string | null;
  /** Node that first created this conversation. */
  origin_node_id?: string | null;
  /** Per-chat provider override; NULL inherits settings.provider. */
  model_provider?: string | null;
  /** Per-chat model override; NULL inherits settings.active_model. */
  model_name?: string | null;
  /** Compute pin for this thread: local | auto | peer id */
  compute_placement?: string | null;
  /** Workspace/repo pin: local | peer id */
  workspace_placement?: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  created_at: number;
  token_count: number;
  parent_message_id: string | null;
  // JSON array of { name, mime, data(base64) } for multimodal (image) input.
  attachments?: string | null;
  /** Which fleet node authored / first persisted this message. */
  origin_node_id?: string | null;
  /** Human label for that node (hostname / peer label) at write time. */
  origin_label?: string | null;
};

function localNodeMeta(): { node_id: string | null; label: string } {
  try {
    // Lazy — identity may not exist until fleet migrations run.
    const { getNodeIdentity } = require("../fleet/identity") as typeof import("../fleet/identity");
    const id = getNodeIdentity();
    const os = require("os") as typeof import("os");
    const label = (os.hostname() || "this-device").split(".")[0];
    return { node_id: id.node_id, label };
  } catch {
    return { node_id: null, label: "this-device" };
  }
}

export function createConversation(profileId?: string, ownerUserId?: string): Conversation {
  const id = nanoid(12);
  const now = Date.now();
  const meta = localNodeMeta();
  getConvDb()
    .prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at, profile_id, owner_user_id, sync_id, origin_node_id) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(id, "New conversation", now, now, profileId ?? null, ownerUserId ?? null, id, meta.node_id);
  return {
    id, title: "New conversation", created_at: now, updated_at: now,
    starred: 0, deleted_at: null, tags: "[]", profile_id: profileId ?? null,
    owner_user_id: ownerUserId ?? null, sync_id: id, origin_node_id: meta.node_id,
  };
}

// Pass an ownerUserId to scope to that user; omit it (owner unified view) for all.
export function listConversations(ownerUserId?: string): Conversation[] {
  const db = getConvDb();
  if (ownerUserId) {
    return db
      .prepare(
        "SELECT * FROM conversations WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY starred DESC, updated_at DESC"
      )
      .all(ownerUserId) as Conversation[];
  }
  return db
    .prepare("SELECT * FROM conversations WHERE deleted_at IS NULL ORDER BY starred DESC, updated_at DESC")
    .all() as Conversation[];
}

export function getConversation(id: string): Conversation | null {
  return (
    (getConvDb().prepare("SELECT * FROM conversations WHERE id=?").get(id) as Conversation) || null
  );
}

export function updateConversation(id: string, patch: Partial<Conversation>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getConvDb().prepare(`UPDATE conversations SET ${set} WHERE id=@id`).run({ ...patch, id } as any);
}

export function getMessages(conversationId: string): Message[] {
  return getConvDb()
    .prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at")
    .all(conversationId) as Message[];
}

export function addMessage(m: Omit<Message, "id" | "created_at"> & { id?: string; created_at?: number }): Message {
  const id = m.id || nanoid(12);
  const created_at = m.created_at || Date.now();
  const meta = localNodeMeta();
  const origin_node_id = m.origin_node_id ?? meta.node_id;
  const origin_label = m.origin_label ?? meta.label;
  const db = getConvDb();
  // Two-table write — wrapped in a transaction so a crash can't half-apply it.
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at, token_count, parent_message_id, attachments, origin_node_id, origin_label) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(
      id, m.conversation_id, m.role, m.content, created_at, m.token_count,
      m.parent_message_id, m.attachments ?? null, origin_node_id, origin_label
    );
    db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(created_at, m.conversation_id);
  });
  tx();
  const row = { id, created_at, ...m, origin_node_id, origin_label };
  // Best-effort mesh fan-out — never blocks the chat path.
  try {
    const { scheduleConversationSync } = require("../fleet/conversation-sync") as typeof import("../fleet/conversation-sync");
    scheduleConversationSync(m.conversation_id);
  } catch { /* fleet not ready */ }
  return row;
}

export function deleteTrailingTurn(conversationId: string) {
  // Remove all messages after (and including) the last user message's responses,
  // i.e. drop trailing assistant + tool messages so the last user message can be re-answered.
  const msgs = getMessages(conversationId);
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return;
  const toDelete = msgs.slice(lastUserIdx + 1);
  const db = getConvDb();
  const stmt = db.prepare("DELETE FROM messages WHERE id=?");
  for (const m of toDelete) stmt.run(m.id);
}

/** Wipe every message in a conversation (keeps the conversation row). */
export function clearConversationMessages(conversationId: string): number {
  const db = getConvDb();
  const info = db.prepare("DELETE FROM messages WHERE conversation_id=?").run(conversationId);
  db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(Date.now(), conversationId);
  return info.changes;
}

/** Replace message list: delete all, then insert the provided rows in order. */
export function replaceConversationMessages(
  conversationId: string,
  rows: {
    role: Message["role"];
    content: string;
    token_count?: number | null;
    parent_message_id?: string | null;
    attachments?: string | null;
    origin_node_id?: string | null;
    origin_label?: string | null;
  }[]
): void {
  const db = getConvDb();
  const now = Date.now();
  const meta = localNodeMeta();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE conversation_id=?").run(conversationId);
    const insert = db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at, token_count, parent_message_id, attachments, origin_node_id, origin_label) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    let t = now - rows.length;
    for (const m of rows) {
      t += 1;
      insert.run(
        nanoid(12),
        conversationId,
        m.role,
        m.content,
        t,
        m.token_count ?? 0,
        m.parent_message_id ?? null,
        m.attachments ?? null,
        m.origin_node_id ?? meta.node_id,
        m.origin_label ?? meta.label
      );
    }
    db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now, conversationId);
  });
  tx();
}

export function getLastUserMessage(conversationId: string): string | null {
  const msgs = getMessages(conversationId);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return msgs[i].content;
  }
  return null;
}

export function searchMessages(query: string): { conversation_id: string; snippet: string }[] {
  return getConvDb()
    .prepare(
      "SELECT conversation_id, substr(content,1,120) AS snippet FROM messages WHERE content LIKE ? LIMIT 50"
    )
    .all(`%${query}%`) as any[];
}

// ---------------- Audit Log ----------------
export type AuditRow = {
  id: number;
  timestamp: number;
  action_type: string;
  tool_name: string;
  input: string;
  output_summary: string | null;
  status: "allowed" | "denied" | "pending" | "failed";
  approved_by: string;
  conversation_id: string | null;
  row_hash: string;
};

export function listAudit(limit = 100, offset = 0, filters?: { tool?: string; status?: string; q?: string; id?: number }): AuditRow[] {
  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const params: any[] = [];
  if (filters?.id != null) { sql += " AND id=?"; params.push(filters.id); }
  if (filters?.tool) { sql += " AND tool_name=?"; params.push(filters.tool); }
  if (filters?.status) { sql += " AND status=?"; params.push(filters.status); }
  if (filters?.q) { sql += " AND (input LIKE ? OR output_summary LIKE ?)"; params.push(`%${filters.q}%`, `%${filters.q}%`); }
  sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return getConfigDb().prepare(sql).all(...params) as AuditRow[];
}

export function getLastAuditHash(): string {
  const r = getConfigDb().prepare("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as
    | { row_hash: string }
    | undefined;
  return r?.row_hash || "";
}

export function insertAuditRow(row: Omit<AuditRow, "id">): number {
  const r = getConfigDb()
    .prepare(
      "INSERT INTO audit_log (timestamp, action_type, tool_name, input, output_summary, status, approved_by, conversation_id, row_hash) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(
      row.timestamp, row.action_type, row.tool_name, row.input, row.output_summary,
      row.status, row.approved_by, row.conversation_id, row.row_hash
    );
  return Number(r.lastInsertRowid);
}

export function updateAuditRow(id: number, patch: Partial<Pick<AuditRow, "output_summary" | "status" | "row_hash">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getConfigDb().prepare(`UPDATE audit_log SET ${set} WHERE id=@id`).run({ ...patch, id } as any);
}

export function getAllAuditOrdered(): AuditRow[] {
  return getConfigDb().prepare("SELECT * FROM audit_log ORDER BY id ASC").all() as AuditRow[];
}
