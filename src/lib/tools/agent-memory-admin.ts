/**
 * agent_memory — Sora's interface to write/retire lessons on her sub-personas.
 *
 * Writers (enforced at the API + tool layer):
 *   - user (UI, REST API)
 *   - sora (this tool)
 *   - system (the critic, internal)
 * Subagents themselves are READ-ONLY — they get rendered lessons at spawn time
 * via buildSubagentSystemPrefix(), but no tool that writes back. This tool is
 * deliberately omitted from persona enabled_tools whitelists; only Sora (who
 * sees the full registry) can call it.
 *
 * Why: lessons should reflect Sora's observation of how a sub-persona performed
 * across many runs, not the sub-persona's own self-narrative. A subagent that
 * could write its own lessons could rationalize a bad pattern into doctrine.
 */

import {
  addMemory, retireMemory, listCommitted, listMemory, getMemory,
  type MemoryKind,
} from "../db/agent-memory";
import { getPersona } from "../db/personas";
import type { Tool } from "./types";

export const agentMemoryAdminTool: Tool = {
  actionType: "memory_write",
  classify: (input) => {
    const op = String(input.operation ?? "");
    return op === "list" ? "memory_read" : "memory_write";
  },
  preview: (input) => {
    const op = String(input.operation ?? "list");
    const persona = String(input.persona_id ?? "?");
    if (op === "record") {
      const snippet = String(input.content ?? "").slice(0, 80);
      return `Record ${String(input.kind ?? "lesson")} for ${persona}: ${snippet}`;
    }
    if (op === "retire") return `Retire memory ${String(input.memory_id ?? "?")} for ${persona}`;
    return `List memory for ${persona}`;
  },
  version: "1",
  cacheable: (input) => String(input.operation ?? "") === "list",
  definition: {
    name: "agent_memory",
    description:
      "Read, write, or retire lessons attached to a sub-persona. Lessons stack into that sub-persona's system prefix on every spawn, so write only what should shape future runs. Kinds: 'lesson' (do this), 'warning' (avoid this), 'preference' (style/format), 'fact' (static info).",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list", "record", "retire"],
          description: "What to do. Defaults to 'list'.",
        },
        persona_id: {
          type: "string",
          description: "The sub-persona this memory belongs to (e.g. 'persona-researcher', 'persona-writer').",
        },
        kind: {
          type: "string",
          enum: ["lesson", "warning", "preference", "fact"],
          description: "For 'record' only. Defaults to 'lesson'.",
        },
        content: {
          type: "string",
          description: "For 'record' only. The lesson text. One or two sentences.",
        },
        memory_id: {
          type: "string",
          description: "For 'retire' only. The id of the memory entry to retire (from a prior list).",
        },
      },
      required: ["persona_id"],
    },
  },
  async execute(input) {
    const personaId = String(input.persona_id ?? "").trim();
    if (!personaId) return { ok: false, output: "persona_id is required" };
    if (!getPersona(personaId)) {
      return { ok: false, output: `Unknown persona: ${personaId}` };
    }
    const op = String(input.operation ?? "list");

    if (op === "list") {
      const items = listMemory(personaId);
      if (items.length === 0) {
        return { ok: true, output: `No memory entries for ${personaId} yet.` };
      }
      const lines = items.map(
        (m) =>
          `[${m.status}] (${m.kind}, by ${m.created_by}) ${m.memory_id} — ${m.content}`
      );
      return {
        ok: true,
        output: lines.join("\n"),
        summary: `${items.length} memory entr${items.length === 1 ? "y" : "ies"} for ${personaId}`,
      };
    }

    if (op === "record") {
      const content = String(input.content ?? "").trim();
      if (!content) return { ok: false, output: "content is required for 'record'" };
      if (content.length > 2000) {
        return { ok: false, output: "content too long (max 2000 chars). Be terse." };
      }
      const kind = (String(input.kind ?? "lesson") as MemoryKind);
      if (!["lesson", "warning", "preference", "fact"].includes(kind)) {
        return { ok: false, output: `Invalid kind: ${kind}` };
      }
      // Sora-authored entries land as 'committed' — Sora has authority.
      const created = addMemory({
        persona_id: personaId,
        kind,
        content,
        status: "committed",
        created_by: "sora",
      });
      return {
        ok: true,
        output: `Recorded ${kind} ${created.memory_id} for ${personaId}.`,
        summary: `Recorded ${kind} for ${personaId}`,
      };
    }

    if (op === "retire") {
      const memId = String(input.memory_id ?? "").trim();
      if (!memId) return { ok: false, output: "memory_id is required for 'retire'" };
      const m = getMemory(memId);
      if (!m || m.persona_id !== personaId) {
        return { ok: false, output: `Memory ${memId} not found for ${personaId}` };
      }
      retireMemory(memId);
      return {
        ok: true,
        output: `Retired ${memId}.`,
        summary: `Retired memory for ${personaId}`,
      };
    }

    return { ok: false, output: `Unknown operation: ${op}` };
  },
};

// Re-export for callers wanting the committed-only view (e.g. the critic).
export { listCommitted };
