/**
 * Loop guard — enforced anti-loop protection at the engine layer.
 *
 * Tracks the last N tool calls per conversation, keyed by
 * (tool_name, sha256(canonicalised_input)). If the same exact key fires
 * MAX_REPEATS times within REPEAT_WINDOW_MS, the engine halts and emits a
 * `loop_suspended` event. The conversation stays paused until the user
 * explicitly resumes via POST /api/chat/resume.
 *
 * This is the one place where Sora CANNOT talk her way past — it's
 * structurally enforced at the dispatch layer, not in the prompt. A model
 * stuck in a tight loop (same web search 10 times, same filesystem read
 * over and over) gets stopped automatically.
 *
 * Design:
 *   - Per-conversation ring buffer (in-memory + persisted to a tiny table)
 *   - O(1) detection on each tool call
 *   - Survives a process restart so a loop that's been suspended stays
 *     suspended across reboots (no "agent re-enters loop after I restart")
 *   - Manual resume clears the suspension; once cleared, the counter resets
 *     so legitimate repeated calls aren't permanently blocked
 */

import crypto from "crypto";
import { getConvDb } from "../db";
import { canonicalJson } from "../fleet/envelope";

const MAX_REPEATS = 5;
const REPEAT_WINDOW_MS = 60_000; // a tool firing 5× in 60s with identical inputs is a loop
const RING_SIZE = 16;             // keep last 16 calls per conversation

// In-memory ring buffer per conversation. Backed by a tiny DB row that holds
// the suspension flag, so a restart doesn't unstuck a known-bad agent.
type Entry = { key: string; at: number };
const ringBuffers = new Map<string, Entry[]>();

type GlobalLoopGuard = {
  rings: Map<string, Entry[]>;
};
const GLOBAL_KEY = Symbol.for("localmind.loop-guard");
const slot = globalThis as unknown as Record<symbol, GlobalLoopGuard>;
if (!slot[GLOBAL_KEY]) slot[GLOBAL_KEY] = { rings: ringBuffers };
const state: GlobalLoopGuard = slot[GLOBAL_KEY];

function ensureTable(): void {
  getConvDb().exec(`
    CREATE TABLE IF NOT EXISTS conversation_loop_state (
      conversation_id TEXT PRIMARY KEY,
      suspended_at INTEGER,
      suspended_reason TEXT,
      offending_tool TEXT,
      offending_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

export function computeCallKey(toolName: string, input: unknown): string {
  const material = canonicalJson({ t: toolName, i: input });
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 24);
}

export type LoopGuardOutcome =
  | { ok: true }
  | { ok: false; suspended: true; reason: string; tool: string; repeats: number };

/**
 * Record a tool call and check for loop conditions. Call this BEFORE
 * dispatching the tool. On a suspension trigger, also persist the suspension
 * to the conv DB so a restart keeps it.
 */
export function checkAndRecord(args: {
  conversation_id: string;
  tool_name: string;
  input: unknown;
}): LoopGuardOutcome {
  ensureTable();

  // Already suspended? Refuse new calls until resumed.
  const existing = getConvDb()
    .prepare("SELECT suspended_at, suspended_reason, offending_tool, offending_count FROM conversation_loop_state WHERE conversation_id=?")
    .get(args.conversation_id) as
    | { suspended_at: number | null; suspended_reason: string | null; offending_tool: string | null; offending_count: number }
    | undefined;
  if (existing && existing.suspended_at) {
    return {
      ok: false,
      suspended: true,
      reason: existing.suspended_reason ?? "Conversation is suspended.",
      tool: existing.offending_tool ?? args.tool_name,
      repeats: existing.offending_count,
    };
  }

  const key = computeCallKey(args.tool_name, args.input);
  const now = Date.now();
  const ring = state.rings.get(args.conversation_id) ?? [];

  // Prune entries outside the window.
  const fresh = ring.filter((e) => now - e.at <= REPEAT_WINDOW_MS);
  fresh.push({ key, at: now });
  if (fresh.length > RING_SIZE) fresh.shift();
  state.rings.set(args.conversation_id, fresh);

  // Count identical keys in the window.
  const repeats = fresh.filter((e) => e.key === key).length;
  if (repeats >= MAX_REPEATS) {
    const reason = `Tool "${args.tool_name}" was called ${repeats} times with identical input in the last ${Math.round(REPEAT_WINDOW_MS / 1000)}s — suspending to prevent a loop.`;
    getConvDb()
      .prepare(
        `INSERT INTO conversation_loop_state (conversation_id, suspended_at, suspended_reason, offending_tool, offending_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           suspended_at=excluded.suspended_at,
           suspended_reason=excluded.suspended_reason,
           offending_tool=excluded.offending_tool,
           offending_count=excluded.offending_count`
      )
      .run(args.conversation_id, now, reason, args.tool_name, repeats);
    // Clear the in-memory ring so a resume starts fresh.
    state.rings.delete(args.conversation_id);
    return {
      ok: false,
      suspended: true,
      reason,
      tool: args.tool_name,
      repeats,
    };
  }

  return { ok: true };
}

export function isSuspended(conversationId: string): { suspended: boolean; reason?: string; tool?: string; repeats?: number; suspended_at?: number } {
  ensureTable();
  const row = getConvDb()
    .prepare("SELECT suspended_at, suspended_reason, offending_tool, offending_count FROM conversation_loop_state WHERE conversation_id=?")
    .get(conversationId) as
    | { suspended_at: number | null; suspended_reason: string | null; offending_tool: string | null; offending_count: number }
    | undefined;
  if (!row || !row.suspended_at) return { suspended: false };
  return {
    suspended: true,
    reason: row.suspended_reason ?? undefined,
    tool: row.offending_tool ?? undefined,
    repeats: row.offending_count,
    suspended_at: row.suspended_at,
  };
}

export function resume(conversationId: string): { resumed: boolean } {
  ensureTable();
  const r = getConvDb()
    .prepare("DELETE FROM conversation_loop_state WHERE conversation_id=?")
    .run(conversationId);
  state.rings.delete(conversationId);
  return { resumed: r.changes > 0 };
}

export const __config = { MAX_REPEATS, REPEAT_WINDOW_MS, RING_SIZE };
