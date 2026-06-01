import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type BlockType = "builtin" | "custom-static" | "custom-conditional";

export type SystemPromptBlock = {
  block_id: string;
  persona_id: string;
  block_type: BlockType;
  block_name: string;
  content: string;
  enabled: number;          // 0 / 1
  sort_order: number;
  condition_json: string | null;
  created_at: number;
  updated_at: number;
};

export type BlockInput = {
  block_id?: string;
  block_type: BlockType;
  block_name: string;
  content?: string;
  enabled?: boolean;
  sort_order?: number;
  condition_json?: string | null;
};

export const BUILTIN_BLOCK_NAMES = [
  "identity",
  "permissions",
  "tools",
  "memory",
  "date_context",
] as const;

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function listBlocks(personaId: string): SystemPromptBlock[] {
  return getConfigDb()
    .prepare("SELECT * FROM system_prompt_blocks WHERE persona_id=? ORDER BY sort_order, block_id")
    .all(personaId) as SystemPromptBlock[];
}

/**
 * Full-replace semantics. Built-in blocks are preserved by name — the caller can
 * reorder/enable them but cannot delete or rename them. Custom blocks come from
 * the input list verbatim.
 */
export function replaceBlocks(personaId: string, blocks: BlockInput[]): void {
  const db = getConfigDb();
  const now = readNow();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM system_prompt_blocks WHERE persona_id=?").run(personaId);

    const seenBuiltins = new Set<string>();
    const ins = db.prepare(
      `INSERT INTO system_prompt_blocks
        (block_id, persona_id, block_type, block_name, content, enabled, sort_order, condition_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );

    blocks.forEach((b, i) => {
      if (b.block_type === "builtin") {
        if (!BUILTIN_BLOCK_NAMES.includes(b.block_name as (typeof BUILTIN_BLOCK_NAMES)[number])) {
          // Unknown builtin — skip rather than break the persona.
          return;
        }
        seenBuiltins.add(b.block_name);
      }
      const id = b.block_id || (b.block_type === "builtin" ? `blk-${personaId.replace(/^persona-/, "")}-${b.block_name}` : `blk-${nanoid(10)}`);
      ins.run(
        id,
        personaId,
        b.block_type,
        b.block_name,
        b.content ?? "",
        b.enabled === false ? 0 : 1,
        b.sort_order ?? i,
        b.block_type === "custom-conditional" ? (b.condition_json ?? null) : null,
        now,
        now
      );
    });

    // Restore any builtin blocks the caller omitted, so they can be re-enabled later
    // without losing the slot. They are appended after the user's chosen order.
    let extra = blocks.length;
    for (const name of BUILTIN_BLOCK_NAMES) {
      if (seenBuiltins.has(name)) continue;
      ins.run(
        `blk-${personaId.replace(/^persona-/, "")}-${name}`,
        personaId,
        "builtin",
        name,
        "",
        0,                  // disabled by default if the user removed it
        extra++,
        null,
        now,
        now
      );
    }
  });
  tx();
}
