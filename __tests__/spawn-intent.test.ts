import { describe, it, expect } from "vitest";
import {
  compileSpawnIntent,
  spawnToolTimeoutMs,
  wantsParallelProse,
  wantsSequentialProse,
} from "../src/lib/agent/spawn-intent";

describe("compileSpawnIntent", () => {
  it("maps a single goal to single mode", () => {
    const intent = compileSpawnIntent({ goal: "research X" });
    expect(intent.mode).toBe("single");
    expect(intent.batch).toHaveLength(1);
  });

  it("defaults multi-unit batch to sequential", () => {
    const intent = compileSpawnIntent({
      batch: [{ goal: "a" }, { goal: "b" }],
    });
    expect(intent.mode).toBe("sequential");
    expect(intent.reason).toMatch(/default/i);
  });

  it("honours explicit parallel mode", () => {
    const intent = compileSpawnIntent({
      batch: [{ goal: "a" }, { goal: "b" }],
      mode: "parallel",
    });
    expect(intent.mode).toBe("parallel");
  });

  it("infers parallel from prose", () => {
    const intent = compileSpawnIntent(
      { batch: [{ goal: "a" }, { goal: "b" }] },
      { userText: "run them in parallel at once" }
    );
    expect(intent.mode).toBe("parallel");
  });

  it("infers sequential from prose over parallel cues when sequential wins first", () => {
    expect(wantsSequentialProse("do them sequentially one at a time")).toBe(true);
    expect(wantsParallelProse("simultaneously")).toBe(true);
    const intent = compileSpawnIntent(
      { batch: [{ goal: "a" }, { goal: "b" }] },
      { userText: "please do this one at a time" }
    );
    expect(intent.mode).toBe("sequential");
  });

  it("inherits top-level timeout/tools/persona onto batch items", () => {
    const intent = compileSpawnIntent({
      allowed_tools: ["web_search"],
      timeout_seconds: 300,
      persona_id: "persona-general",
      mode: "sequential",
      batch: [
        { goal: "LinkedIn", persona_id: "persona-researcher" },
        { goal: "Indeed" },
      ],
    });
    expect(intent.batch[0]).toMatchObject({
      persona_id: "persona-researcher",
      allowed_tools: ["web_search"],
      timeout_seconds: 300,
    });
    expect(intent.batch[1]).toMatchObject({
      persona_id: "persona-general",
      allowed_tools: ["web_search"],
      timeout_seconds: 300,
    });
  });

  it("sizes outer spawn timeout from sequential child budgets (not 30s)", () => {
    const ms = spawnToolTimeoutMs({
      mode: "sequential",
      timeout_seconds: 300,
      batch: [
        { goal: "a" },
        { goal: "b" },
        { goal: "c" },
        { goal: "d" },
      ],
    });
    // 4 × 300s + overhead — must clear the engine's old 30s ceiling.
    expect(ms).toBeGreaterThan(30_000);
    expect(ms).toBeGreaterThanOrEqual(4 * 300 * 1000);
    expect(ms).toBeLessThanOrEqual(20 * 60 * 1000);
  });

  it("uses max child timeout for parallel batches", () => {
    const ms = spawnToolTimeoutMs({
      mode: "parallel",
      batch: [
        { goal: "a", timeout_seconds: 60 },
        { goal: "b", timeout_seconds: 120 },
      ],
    });
    expect(ms).toBeGreaterThanOrEqual(120_000);
    expect(ms).toBeLessThan(4 * 60_000);
  });
});
