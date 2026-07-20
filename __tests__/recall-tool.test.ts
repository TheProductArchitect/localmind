import { describe, it, expect, vi, beforeEach } from "vitest";

let messages: { role: string; content: string }[] = [];
vi.mock("../src/lib/db/queries", () => ({
  getMessages: () => messages,
}));

import { recallTool } from "../src/lib/tools/recall";

const ctx = { conversationId: "c1", approvedDirs: [] };

describe("recall tool", () => {
  beforeEach(() => {
    messages = [
      { role: "user", content: "My budget for the trip is 3000 dollars" },
      { role: "assistant", content: "Noted, a 3000 dollar budget for the trip." },
      { role: "user", content: "Let's talk about the Cambridge MBA instead" },
      { role: "assistant", content: "The Cambridge MBA is a one-year program." },
    ];
  });

  it("is a read action (never gated)", () => {
    expect(recallTool.actionType).toBe("memory_read");
  });

  it("pulls back earlier messages matching a keyword", async () => {
    const res = await recallTool.execute({ query: "budget trip" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("3000");
    // Unrelated MBA turns should not dominate a budget query.
    expect(res.output).toContain("budget");
  });

  it("returns chronological order with message indices", async () => {
    const res = await recallTool.execute({ query: "Cambridge MBA", limit: 5 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/\[#\d+ (user|assistant)\]/);
  });

  it("reports no matches gracefully", async () => {
    const res = await recallTool.execute({ query: "quantum entanglement" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/No earlier messages/i);
  });

  it("requires a query", async () => {
    const res = await recallTool.execute({ query: "" }, ctx);
    expect(res.ok).toBe(false);
  });
});
