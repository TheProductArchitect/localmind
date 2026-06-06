/**
 * Per-agent memory — lessons the agent reads at spawn time but never writes.
 *
 * Writers (enforced at the API layer):
 *   - user:   adds via the /agents UI
 *   - sora:   adds via the record_agent_lesson tool
 *   - system: adds via the critic when reviewing completed subagents
 *
 * Status:
 *   - committed — active, injected into the agent's system prefix
 *   - proposed  — queued for sora/user review, NOT yet injected
 *   - retired   — soft-deleted, kept for audit
 */

import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type MemoryKind = "lesson" | "warning" | "preference" | "fact";
export type MemoryStatus = "committed" | "proposed" | "retired";
export type MemoryAuthor = "user" | "sora" | "system";

export type AgentMemory = {
  memory_id: string;
  persona_id: string;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  created_by: MemoryAuthor;
  confidence: number;
  source_subagent_process_id: string | null;
  created_at: number;
  retired_at: number | null;
};

export function listMemory(personaId: string, opts: { status?: MemoryStatus } = {}): AgentMemory[] {
  const db = getConfigDb();
  if (opts.status) {
    return db
      .prepare(
        "SELECT * FROM agent_memory WHERE persona_id=? AND status=? ORDER BY created_at DESC"
      )
      .all(personaId, opts.status) as AgentMemory[];
  }
  return db
    .prepare("SELECT * FROM agent_memory WHERE persona_id=? AND status != 'retired' ORDER BY created_at DESC")
    .all(personaId) as AgentMemory[];
}

/** Read-only set the spawned agent sees in its system prefix. Excludes
 *  proposed entries (those haven't been confirmed) and retired entries. */
export function listCommitted(personaId: string, limit = 30): AgentMemory[] {
  return getConfigDb()
    .prepare(
      "SELECT * FROM agent_memory WHERE persona_id=? AND status='committed' ORDER BY created_at DESC LIMIT ?"
    )
    .all(personaId, limit) as AgentMemory[];
}

export function addMemory(args: {
  persona_id: string;
  kind: MemoryKind;
  content: string;
  status?: MemoryStatus;
  created_by: MemoryAuthor;
  confidence?: number;
  source_subagent_process_id?: string | null;
}): AgentMemory {
  const id = `mem-${nanoid(10)}`;
  const now = Date.now();
  getConfigDb()
    .prepare(
      `INSERT INTO agent_memory
         (memory_id, persona_id, kind, content, status, created_by, confidence, source_subagent_process_id, created_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      args.persona_id,
      args.kind,
      args.content,
      args.status ?? "committed",
      args.created_by,
      args.confidence ?? 1.0,
      args.source_subagent_process_id ?? null,
      now
    );
  return getMemory(id)!;
}

export function getMemory(memoryId: string): AgentMemory | null {
  const row = getConfigDb()
    .prepare("SELECT * FROM agent_memory WHERE memory_id=?")
    .get(memoryId) as AgentMemory | undefined;
  return row ?? null;
}

export function setMemoryStatus(memoryId: string, status: MemoryStatus): boolean {
  const r = getConfigDb()
    .prepare(
      `UPDATE agent_memory SET status=?, retired_at=CASE WHEN ?='retired' THEN ? ELSE NULL END WHERE memory_id=?`
    )
    .run(status, status, Date.now(), memoryId);
  return r.changes > 0;
}

export function retireMemory(memoryId: string): boolean {
  return setMemoryStatus(memoryId, "retired");
}

/** Used by the spawn path to render the memory section of the system prefix. */
export function renderMemoryBlock(personaId: string): string {
  const items = listCommitted(personaId);
  if (items.length === 0) return "";
  const lines = items.map((m) => {
    const tag = m.kind === "warning" ? "⚠" : m.kind === "preference" ? "•" : m.kind === "fact" ? "ⓘ" : "✓";
    return `  ${tag} ${m.content}`;
  });
  return [
    `LESSONS LEARNED (your memory — read-only; only Sora, the user, or the critic add to this):`,
    ...lines,
  ].join("\n");
}
