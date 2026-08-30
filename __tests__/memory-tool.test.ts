import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMemory, upsertMemory, deleteMemory, getConversation } = vi.hoisted(() => ({
  listMemory: vi.fn(),
  upsertMemory: vi.fn(),
  deleteMemory: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock("../src/lib/db/queries", () => ({
  listMemory,
  upsertMemory,
  deleteMemory,
  getConversation,
}));

import { memoryTool } from "../src/lib/tools/memory";

const ctx = { conversationId: "conv-1", approvedDirs: [] };

describe("memory tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversation.mockReturnValue({ id: "conv-1", owner_user_id: "user-1" });
    listMemory.mockReturnValue([
      { id: "m1", key: "timezone", value: "Europe/London", user_id: "user-1" },
    ]);
    upsertMemory.mockReturnValue({ id: "m2", key: "drink", value: "tea" });
  });

  it("scopes reads to the active conversation owner", async () => {
    const result = await memoryTool.execute({ operation: "read" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("timezone: Europe/London");
    expect(listMemory).toHaveBeenCalledWith("user-1");
  });

  it("assigns writes to the active conversation owner", async () => {
    const result = await memoryTool.execute(
      { operation: "write", key: "drink", value: "tea" },
      ctx
    );
    expect(result.ok).toBe(true);
    expect(upsertMemory).toHaveBeenCalledWith("drink", "tea", "conv-1", "user-1");
  });

  it("cannot delete a key outside the owner's visible memory", async () => {
    const result = await memoryTool.execute({ operation: "delete", key: "other-user-key" }, ctx);
    expect(result.ok).toBe(false);
    expect(deleteMemory).not.toHaveBeenCalled();
    expect(listMemory).toHaveBeenCalledWith("user-1");
  });

  it("deletes an owned memory by id", async () => {
    const result = await memoryTool.execute({ operation: "delete", key: "timezone" }, ctx);
    expect(result.ok).toBe(true);
    expect(deleteMemory).toHaveBeenCalledWith("m1");
  });

  it("does not cache reads because memory may change during a turn", () => {
    expect(memoryTool.cacheable?.({ operation: "read" })).toBe(false);
  });

  it("rejects incomplete writes", async () => {
    const result = await memoryTool.execute({ operation: "write", key: "drink" }, ctx);
    expect(result.ok).toBe(false);
    expect(upsertMemory).not.toHaveBeenCalled();
  });
});
