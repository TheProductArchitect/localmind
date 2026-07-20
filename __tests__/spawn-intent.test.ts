import { describe, it, expect } from "vitest";
import { compileSpawnIntent, wantsParallelProse, wantsSequentialProse } from "../src/lib/agent/spawn-intent";

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
});
