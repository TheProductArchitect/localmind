import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/db/queries", () => ({
  createConversation: vi.fn(() => ({ id: "sub-1" })),
  getConversation: vi.fn(() => ({ id: "parent-1", profile_id: null, owner_user_id: null })),
}));

vi.mock("../src/lib/db", () => ({
  getConvDb: vi.fn(() => ({
    prepare: () => ({
      get: () => ({ tags: "[]" }),
      run: () => undefined,
    }),
  })),
}));

vi.mock("../src/lib/db/personas", () => ({
  listPersonas: vi.fn(() => []),
}));

vi.mock("../src/lib/db/agent-memory", () => ({
  renderMemoryBlock: vi.fn(() => ""),
}));

vi.mock("../src/lib/agent/engine", () => ({
  runAgentCollect: vi.fn(async () => "ok"),
}));

vi.mock("../src/lib/agent/resource-governor", () => ({
  decideCapacity: vi.fn(async () => ({ max_concurrent: 4, warnings: [] })),
  SANITY_CEILING: 16,
}));

import { spawnSubagentsSequentialTool, spawnSubagentsParallelTool } from "../src/lib/tools/subagent";

describe("spawn_subagents_sequential", () => {
  const ctx = { conversationId: "parent-1", approvedDirs: [] as string[] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty / oversize / missing-goal batches", async () => {
    const empty = await spawnSubagentsSequentialTool.execute({ batch: [] }, ctx);
    const oversize = await spawnSubagentsSequentialTool.execute(
      { batch: Array.from({ length: 20 }, (_, i) => ({ goal: `g${i}` })) },
      ctx
    );
    const missing = await spawnSubagentsSequentialTool.execute({ batch: [{ goal: "" }] }, ctx);
    expect(empty.ok).toBe(false);
    expect(oversize.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(empty.output).toMatch(/at least one/);
    expect(oversize.output).toMatch(/exceeds the maximum/);
    expect(missing.output).toMatch(/required/);
  });

  it("accepts a stringified batch (small-model narration)", async () => {
    const r = await spawnSubagentsSequentialTool.execute(
      { batch: JSON.stringify([{ goal: "one" }, { goal: "two" }]) },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/Sequential batch of 2/);
    expect(r.output).toMatch(/one at a time/);
    expect(r.summary).toMatch(/mode=sequential/);
  });

  it("runs children one at a time (never overlaps)", async () => {
    const { runAgentCollect } = await import("../src/lib/agent/engine");
    let inFlight = 0;
    let peak = 0;
    vi.mocked(runAgentCollect).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return "done";
    });

    const r = await spawnSubagentsSequentialTool.execute(
      { batch: [{ goal: "a" }, { goal: "b" }, { goal: "c" }] },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(peak).toBe(1);
    expect(vi.mocked(runAgentCollect)).toHaveBeenCalledTimes(3);
  });
});

describe("spawn_subagents_parallel (still concurrent)", () => {
  const ctx = { conversationId: "parent-1", approvedDirs: [] as string[] };

  it("can run more than one child at once", async () => {
    const { runAgentCollect } = await import("../src/lib/agent/engine");
    let inFlight = 0;
    let peak = 0;
    vi.mocked(runAgentCollect).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
      return "done";
    });

    const r = await spawnSubagentsParallelTool.execute(
      { batch: [{ goal: "a" }, { goal: "b" }, { goal: "c" }], max_parallel: 3 },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(peak).toBeGreaterThan(1);
    expect(r.output).toMatch(/Parallel batch/);
  });
});
