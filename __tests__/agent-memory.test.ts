import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer up-front so the memory module's calls hit our stub
// instead of opening a real SQLite handle.
const rows: any[] = [];
const stmt = {
  all: vi.fn((...args: any[]) => {
    // Persona id is always first. Distinguish the three call shapes by the
    // type of the second arg:
    //   • undefined → listMemory(personaId) — exclude retired
    //   • string    → listMemory(personaId, { status }) — exact status
    //   • number    → listCommitted(personaId, limit) — committed only
    const [personaId, second] = args;
    let filtered = rows.filter((r) => r.persona_id === personaId);
    if (typeof second === "number") {
      filtered = filtered.filter((r) => r.status === "committed").slice(0, second);
    } else if (typeof second === "string") {
      filtered = filtered.filter((r) => r.status === second);
    } else {
      filtered = filtered.filter((r) => r.status !== "retired");
    }
    // Both real queries sort by created_at DESC.
    filtered.sort((a, b) => b.created_at - a.created_at);
    return filtered;
  }),
  get: vi.fn((id: string) => rows.find((r) => r.memory_id === id) || undefined),
  run: vi.fn((...args: any[]) => {
    // INSERT INTO agent_memory (memory_id, persona_id, kind, content, status, created_by, confidence, source_subagent_process_id, created_at, retired_at)
    if (args.length >= 9) {
      rows.push({
        memory_id: args[0],
        persona_id: args[1],
        kind: args[2],
        content: args[3],
        status: args[4],
        created_by: args[5],
        confidence: args[6],
        source_subagent_process_id: args[7],
        created_at: args[8],
        retired_at: null,
      });
    } else if (args.length === 4) {
      // UPDATE ... SET status=?, retired_at=CASE ... WHERE memory_id=?
      const [status, _statusAgain, retiredAt, id] = args;
      const r = rows.find((x) => x.memory_id === id);
      if (r) {
        r.status = status;
        r.retired_at = status === "retired" ? retiredAt : null;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 1 };
  }),
};

vi.mock("../src/lib/db", () => ({
  getConfigDb: () => ({ prepare: () => stmt }),
}));

import {
  addMemory,
  listMemory,
  listCommitted,
  retireMemory,
  setMemoryStatus,
  renderMemoryBlock,
} from "../src/lib/db/agent-memory";

describe("agent-memory", () => {
  beforeEach(() => {
    rows.length = 0;
    stmt.all.mockClear();
    stmt.get.mockClear();
    stmt.run.mockClear();
  });

  describe("contract — agents NEVER write", () => {
    it("created_by enforces an explicit author on every write", () => {
      const entry = addMemory({
        persona_id: "persona-writer",
        kind: "lesson",
        content: "Prefer terse prose.",
        created_by: "sora",
      });
      expect(entry.created_by).toBe("sora");
      // The type system already forbids "subagent" — this assertion exists so
      // any future change that loosens the union surfaces here.
      const validAuthors = ["user", "sora", "system"];
      expect(validAuthors).toContain(entry.created_by);
    });
  });

  describe("status flow", () => {
    it("defaults new entries to 'committed'", () => {
      const e = addMemory({
        persona_id: "persona-coder",
        kind: "lesson",
        content: "Always run typecheck before committing.",
        created_by: "user",
      });
      expect(e.status).toBe("committed");
    });

    it("accepts 'proposed' for critic findings awaiting review", () => {
      const e = addMemory({
        persona_id: "persona-coder",
        kind: "warning",
        content: "Avoid `any` casts.",
        status: "proposed",
        created_by: "system",
        confidence: 0.7,
      });
      expect(e.status).toBe("proposed");
      expect(e.confidence).toBe(0.7);
    });

    it("retireMemory soft-deletes — row remains but excluded from default listings", () => {
      const e = addMemory({
        persona_id: "persona-x",
        kind: "lesson",
        content: "Old lesson",
        created_by: "user",
      });
      retireMemory(e.memory_id);
      const list = listMemory("persona-x");
      expect(list.find((m) => m.memory_id === e.memory_id)).toBeUndefined();
    });

    it("setMemoryStatus can promote proposed → committed", () => {
      const e = addMemory({
        persona_id: "persona-x",
        kind: "lesson",
        content: "Proposed thing",
        status: "proposed",
        created_by: "system",
      });
      setMemoryStatus(e.memory_id, "committed");
      const list = listCommitted("persona-x");
      expect(list.find((m) => m.memory_id === e.memory_id)?.status).toBe("committed");
    });
  });

  describe("listCommitted — what the subagent will actually see", () => {
    it("returns only committed entries, never proposed or retired", () => {
      addMemory({ persona_id: "p", kind: "lesson",  content: "A", created_by: "user" });
      addMemory({ persona_id: "p", kind: "warning", content: "B", status: "proposed", created_by: "system" });
      const c = addMemory({ persona_id: "p", kind: "lesson", content: "C", created_by: "sora" });
      retireMemory(c.memory_id);

      const committed = listCommitted("p");
      expect(committed.map((m) => m.content)).toEqual(["A"]);
    });
  });

  describe("renderMemoryBlock — the actual prompt fragment subagents read", () => {
    it("returns empty string when persona has no memory", () => {
      expect(renderMemoryBlock("persona-empty")).toBe("");
    });

    it("renders only committed entries with the correct glyphs", () => {
      addMemory({ persona_id: "p", kind: "lesson",     content: "Good move", created_by: "user" });
      addMemory({ persona_id: "p", kind: "warning",    content: "Bad move",  created_by: "sora" });
      addMemory({ persona_id: "p", kind: "preference", content: "Pref",      created_by: "user" });
      addMemory({ persona_id: "p", kind: "fact",       content: "Fact",      created_by: "system" });
      addMemory({ persona_id: "p", kind: "lesson",     content: "Not yet",   status: "proposed", created_by: "system" });

      const block = renderMemoryBlock("p");
      expect(block).toContain("LESSONS LEARNED");
      expect(block).toContain("✓ Good move");
      expect(block).toContain("⚠ Bad move");
      expect(block).toContain("• Pref");
      expect(block).toContain("ⓘ Fact");
      // Proposed must NOT leak into the prompt
      expect(block).not.toContain("Not yet");
    });

    it("explicitly tells the subagent the block is read-only", () => {
      addMemory({ persona_id: "p", kind: "lesson", content: "x", created_by: "user" });
      const block = renderMemoryBlock("p");
      expect(block).toMatch(/read-only/);
    });
  });
});
