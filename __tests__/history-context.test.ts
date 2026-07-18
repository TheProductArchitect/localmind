import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { splitHistory } from "../src/lib/agent/history-context";
import { runMigrations } from "../src/lib/db/migrations";

type M = { role: string; content: string };
const seq = (roles: string[]): M[] => roles.map((role, i) => ({ role, content: `${role}-${i}` }));

describe("splitHistory", () => {
  it("keeps everything verbatim when at or under the window", () => {
    const msgs = seq(["user", "assistant", "user"]);
    const { older, recent } = splitHistory(msgs, 16);
    expect(older).toHaveLength(0);
    expect(recent).toHaveLength(3);
  });

  it("splits older vs recent by the window size", () => {
    const msgs = seq(Array.from({ length: 20 }, (_, i) => (i % 2 ? "assistant" : "user")));
    const { older, recent } = splitHistory(msgs, 6);
    expect(recent).toHaveLength(6);
    expect(older).toHaveLength(14);
  });

  it("never lets the recent window begin with an orphan tool result", () => {
    // Boundary would land on a tool message; it should move back to the
    // assistant turn that produced it.
    const msgs: M[] = [
      { role: "user", content: "u0" },
      { role: "assistant", content: "a1" },
      { role: "tool", content: "t2" },      // window boundary would fall here
      { role: "tool", content: "t3" },
      { role: "assistant", content: "a4" },
    ];
    const { recent } = splitHistory(msgs, 3);
    expect(recent[0].role).not.toBe("tool");
    expect(recent[0].role).toBe("assistant");
  });
});

describe("conversation_summaries migration (conv v3)", () => {
  it("creates the table", () => {
    const db = new Database(":memory:");
    runMigrations(db, "conversations");
    const cols = (db.prepare("PRAGMA table_info(conversation_summaries)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["conversation_id", "summary", "covered_count", "updated_at"]));
    db.close();
  });
});
