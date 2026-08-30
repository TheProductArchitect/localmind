import { describe, it, expect, vi, beforeEach } from "vitest";

let messages: { role: string; content: string }[] = [];
let history: {
  conversation_id: string;
  conversation_title: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}[] = [];
vi.mock("../src/lib/db/queries", () => ({
  getMessages: () => messages,
  getConversation: () => ({ id: "c1", owner_user_id: "user-1" }),
  searchConversationHistory: () => history,
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
    history = [
      {
        conversation_id: "older-trip",
        conversation_title: "Lisbon planning",
        role: "user",
        content: "My budget for the trip is 3000 dollars",
        created_at: Date.UTC(2026, 6, 1),
      },
      {
        conversation_id: "older-mba",
        conversation_title: "MBA research",
        role: "assistant",
        content: "The Cambridge MBA is a one-year program.",
        created_at: Date.UTC(2026, 5, 1),
      },
    ];
  });

  it("is a read action (never gated)", () => {
    expect(recallTool.actionType).toBe("memory_read");
  });

  it("pulls back earlier messages matching a keyword", async () => {
    const res = await recallTool.execute({ query: "budget trip", scope: "current" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("3000");
    // Unrelated MBA turns should not dominate a budget query.
    expect(res.output).toContain("budget");
  });

  it("returns chronological order with message indices", async () => {
    const res = await recallTool.execute(
      { query: "Cambridge MBA", limit: 5, scope: "current" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/\[#\d+ (user|assistant)\]/);
  });

  it("reports no matches gracefully", async () => {
    const res = await recallTool.execute(
      { query: "quantum entanglement", scope: "current" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/No earlier messages/i);
  });

  it("requires a query", async () => {
    const res = await recallTool.execute({ query: "" }, ctx);
    expect(res.ok).toBe(false);
  });

  it("searches prior conversations by default and returns source metadata", async () => {
    const res = await recallTool.execute({ query: "budget trip" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("Lisbon planning");
    expect(res.output).toContain("conversation:older-trip");
    expect(res.output).toContain("3000 dollars");
    expect(res.summary).toMatch(/conversation history/);
  });

  it("does not mix unrelated prior conversations into the result", async () => {
    const res = await recallTool.execute({ query: "budget trip" }, ctx);
    expect(res.output).not.toContain("MBA research");
  });
});
