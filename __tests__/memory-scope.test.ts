import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/lib/db/migrations";

let db: Database.Database;
vi.mock("../src/lib/db", () => ({ getConfigDb: () => db }));

import { upsertMemory, listMemory } from "../src/lib/db/queries";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, "config");
});

describe("memory scoping — the 'saved but not visible' bug", () => {
  it("listMemory(userId) includes unowned (null user_id) memory the tool wrote", () => {
    upsertMemory("about_me", "Venu — PM", undefined, undefined); // tool write, no owner → null
    upsertMemory("pref", "concise", undefined, "userA");         // owned by A
    upsertMemory("secret", "B only", undefined, "userB");        // owned by B

    const forA = listMemory("userA");
    const keys = forA.map((m) => m.key).sort();
    expect(keys).toEqual(["about_me", "pref"]); // sees own + unowned, not B's
    expect(keys).not.toContain("secret");
  });

  it("listMemory() (no user) returns everything (agent read path)", () => {
    upsertMemory("about_me", "Venu", undefined, undefined);
    upsertMemory("pref", "concise", undefined, "userA");
    expect(listMemory()).toHaveLength(2);
  });

  it("stores key/value (what the Memory UI now renders)", () => {
    const item = upsertMemory("role", "Senior PM", undefined, undefined);
    expect(item).toMatchObject({ key: "role", value: "Senior PM" });
    expect(listMemory("owner")[0]).toMatchObject({ key: "role", value: "Senior PM" });
  });
});
