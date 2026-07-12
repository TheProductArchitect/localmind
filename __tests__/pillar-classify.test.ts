import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { classifyPillar } from "../src/lib/agent/pillar-classify";
import { runMigrations } from "../src/lib/db/migrations";

describe("classifyPillar", () => {
  it("maps known personas directly", () => {
    expect(classifyPillar("anything", "persona-strategist")).toBe("ideate");
    expect(classifyPillar("anything", "agent-researcher")).toBe("research");
    expect(classifyPillar("anything", "agent-coder")).toBe("execute");
    expect(classifyPillar("anything", "agent-comms")).toBe("communicate");
  });

  it("classifies by keyword when no persona hint", () => {
    expect(classifyPillar("brainstorm some ideas for the launch")).toBe("ideate");
    expect(classifyPillar("send an email to Priya")).toBe("communicate");
    expect(classifyPillar("research the latest vector databases")).toBe("research");
    expect(classifyPillar("implement the login page and fix the bug")).toBe("execute");
    expect(classifyPillar("delegate this to multiple agents in parallel")).toBe("coordinate");
  });

  it("prioritizes ideate over communicate for planning phrased with a channel", () => {
    expect(classifyPillar("brainstorm how to email everyone")).toBe("ideate");
  });

  it("returns null when unclassifiable", () => {
    expect(classifyPillar("")).toBeNull();
    expect(classifyPillar("hello there")).toBeNull();
  });
});

describe("Strategist persona seed (migration v24)", () => {
  it("creates persona-strategist with an ideate block", () => {
    const db = new Database(":memory:");
    runMigrations(db, "config");
    const persona = db.prepare("SELECT * FROM personas WHERE persona_id='persona-strategist'").get() as any;
    expect(persona).toBeTruthy();
    expect(persona.name).toBe("Strategist");
    const block = db
      .prepare("SELECT * FROM system_prompt_blocks WHERE persona_id='persona-strategist' AND block_name='ideate'")
      .get() as any;
    expect(block).toBeTruthy();
    expect(block.content).toContain("DIVERGE");
    db.close();
  });
});
