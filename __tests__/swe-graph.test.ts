import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/db", () => ({
  getConfigDb: () => ({
    transaction: (fn: () => unknown) => () => fn(),
  }),
}));

vi.mock("../src/lib/db/task-graphs", () => ({
  createGraph: vi.fn((args: any) => ({ graph_id: "g-1", ...args })),
  addNode: vi.fn((args: any) => ({ node_id: `n-${Math.random().toString(36).slice(2, 6)}`, ...args })),
}));

vi.mock("../src/lib/fleet/identity", () => ({
  getNodeIdentity: () => ({ node_id: "local" }),
}));

import { buildSweGraph } from "../src/lib/coding/swe-graph";
import { addNode } from "../src/lib/db/task-graphs";

describe("buildSweGraph", () => {
  it("builds a 5-step linear SWE graph", () => {
    buildSweGraph({
      sessionId: "csess-1",
      goal: "Add rate limiting",
      worktreePath: "/tmp/wt",
    });
    expect(vi.mocked(addNode).mock.calls.length).toBe(5);
    const personas = vi.mocked(addNode).mock.calls.map((c) => c[0].agent_spec.persona_id);
    expect(personas[0]).toBe("persona-strategist");
    expect(personas[1]).toBe("agent-coder");
    expect(personas[3]).toBe("agent-reviewer");
    for (const c of vi.mocked(addNode).mock.calls) {
      expect(c[0].input.coding_session_id).toBe("csess-1");
    }
  });
});
