import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup, store, computeToolInputHash } = vi.hoisted(() => ({
  lookup: vi.fn(),
  store: vi.fn(),
  computeToolInputHash: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../src/lib/db/tool-call-cache", () => ({
  lookup,
  store,
  computeToolInputHash,
}));
vi.mock("../src/lib/fleet/workspace-route", () => ({
  resolveWorkspaceRelayPeer: () => null,
}));
vi.mock("../src/lib/fleet/workspace-relay-initiator", () => ({
  relayWorkspaceToolToPeer: vi.fn(),
}));
vi.mock("../src/lib/fleet/workspace-session-mirror", () => ({
  mirrorRemoteCodingSession: vi.fn(),
}));
vi.mock("../src/lib/fleet/tool-relay-context", () => ({
  getToolHome: () => null,
  isToolRelayInbound: () => false,
}));
vi.mock("../src/lib/fleet/handlers/tool-relay", () => ({
  TOOL_RELAY_TOOLS: new Set(),
}));
vi.mock("../src/lib/fleet/tool-relay-initiator", () => ({
  relayToolToPeer: vi.fn(),
}));

import { executeWithCache } from "../src/lib/agent/tool-cache-wrapper";
import type { Tool } from "../src/lib/tools/types";

const tool: Tool = {
  actionType: "memory_read",
  version: "2",
  cacheable: () => true,
  definition: {
    name: "recall",
    description: "test",
    parameters: { type: "object", properties: {} },
  },
  execute: vi.fn(async () => ({ ok: true, output: "secret-from-other-thread" })),
};

describe("tool cache scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockReturnValue(null);
  });

  it("hashes conversation id into the cache key so threads cannot share hits", async () => {
    await executeWithCache(tool, { query: "budget" }, {
      conversationId: "conv-a",
      approvedDirs: [],
    });
    expect(computeToolInputHash).toHaveBeenCalledWith({
      input: { query: "budget" },
      conversationId: "conv-a",
      codingSessionId: null,
    });

    await executeWithCache(tool, { query: "budget" }, {
      conversationId: "conv-b",
      approvedDirs: [],
    });
    expect(computeToolInputHash).toHaveBeenLastCalledWith({
      input: { query: "budget" },
      conversationId: "conv-b",
      codingSessionId: null,
    });
  });
});
