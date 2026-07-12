import { describe, it, expect, vi, beforeEach } from "vitest";

const semanticSearch = vi.fn();
vi.mock("../src/lib/knowledge/search", () => ({
  semanticSearch: (...a: any[]) => semanticSearch(...a),
}));

let memory: { key: string; value: string }[] = [];
let settings: any = { context_window: 8000 };
vi.mock("../src/lib/db/queries", () => ({
  listMemory: () => memory,
  getSettings: () => settings,
}));

import {
  packWithinBudget,
  estimateTokens,
  retrieveContext,
  defaultBudgetTokens,
  type ContextItem,
} from "../src/lib/agent/context-broker";

describe("packWithinBudget", () => {
  it("keeps highest-scoring items and respects the token budget", () => {
    const items: ContextItem[] = [
      { text: "a".repeat(400), source: "s1", score: 0.9 }, // 100 tokens
      { text: "b".repeat(400), source: "s2", score: 0.8 }, // 100 tokens
      { text: "c".repeat(400), source: "s3", score: 0.7 }, // 100 tokens
    ];
    const kept = packWithinBudget(items, 250);
    expect(kept.map((k) => k.source)).toEqual(["s1", "s2"]);
  });

  it("skips near-duplicate items", () => {
    const items: ContextItem[] = [
      { text: "the quick brown fox jumps over the lazy dog", source: "s1", score: 0.9 },
      { text: "the quick brown fox jumps over the lazy dog today", source: "s2", score: 0.8 },
      { text: "completely different unrelated sentence about oranges", source: "s3", score: 0.7 },
    ];
    const kept = packWithinBudget(items, 10000);
    expect(kept.map((k) => k.source)).toEqual(["s1", "s3"]);
  });
});

describe("defaultBudgetTokens", () => {
  beforeEach(() => { settings = { context_window: 8000 }; });
  it("is a fraction of the context window", () => {
    expect(defaultBudgetTokens()).toBe(1200); // 8000 * 0.15
  });
  it("falls back when no context window is set", () => {
    settings = {};
    expect(defaultBudgetTokens()).toBeGreaterThan(0);
  });
});

describe("retrieveContext", () => {
  beforeEach(() => {
    semanticSearch.mockReset();
    memory = [];
    settings = { context_window: 8000 };
  });

  it("packs knowledge hits and memory within budget and cites sources", async () => {
    semanticSearch.mockResolvedValue([
      { text: "Vector DBs store embeddings", documentName: "notes.md", score: 0.82 },
    ]);
    memory = [{ key: "name", value: "Venu" }];
    const res = await retrieveContext({ query: "what vector db should I use", userId: "u1" });
    expect(res.gap).toBeNull();
    expect(res.brief).toContain("knowledge:notes.md");
    expect(res.usedTokens).toBeLessThanOrEqual(res.budgetTokens);
  });

  it("returns a coverage gap when nothing is relevant", async () => {
    semanticSearch.mockResolvedValue([]);
    memory = [];
    const res = await retrieveContext({ query: "obscure topic" });
    expect(res.items).toHaveLength(0);
    expect(res.gap).toBeTruthy();
    expect(res.brief).toContain(res.gap!);
  });

  it("degrades to memory-only when embeddings/search throw", async () => {
    semanticSearch.mockRejectedValue(new Error("ollama down"));
    memory = [{ key: "role", value: "engineer" }];
    const res = await retrieveContext({ query: "role" });
    expect(res.items.some((i) => i.source === "memory")).toBe(true);
  });

  it("never exceeds the token budget", async () => {
    semanticSearch.mockResolvedValue([
      { text: "x".repeat(4000), documentName: "big.md", score: 0.9 },
    ]);
    const res = await retrieveContext({ query: "q", budgetTokens: 100 });
    expect(res.usedTokens).toBeLessThanOrEqual(100);
  });
});

describe("estimateTokens", () => {
  it("approximates 4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
