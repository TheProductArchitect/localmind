import { describe, expect, it } from "vitest";
import {
  isLikelyEmbeddingModel,
  modelTagsMatch,
  pickPreferredOllamaModel,
} from "@/lib/curated-models";

describe("modelTagsMatch", () => {
  it("matches exact tags and :latest aliases", () => {
    expect(modelTagsMatch("llama3.2", "llama3.2")).toBe(true);
    expect(modelTagsMatch("llama3.2", "llama3.2:latest")).toBe(true);
    expect(modelTagsMatch("llama3.2:latest", "llama3.2")).toBe(true);
    expect(modelTagsMatch("llama3.2:3b", "llama3.2:latest")).toBe(false);
  });
});

describe("isLikelyEmbeddingModel", () => {
  it("filters embed / bert families", () => {
    expect(isLikelyEmbeddingModel({ name: "nomic-embed-text" })).toBe(true);
    expect(isLikelyEmbeddingModel({ name: "mxbai-embed-large", family: "bert" })).toBe(true);
    expect(isLikelyEmbeddingModel({ name: "llama3.2:3b", family: "llama" })).toBe(false);
  });
});

describe("pickPreferredOllamaModel", () => {
  it("prefers curated chat models and skips embeddings", () => {
    const picked = pickPreferredOllamaModel([
      { name: "nomic-embed-text", family: "nomic-bert", modified: "2026-01-01" },
      { name: "mistral:7b", family: "mistral", modified: "2026-01-02" },
      { name: "llama3.2:3b", family: "llama", modified: "2026-01-01" },
    ]);
    expect(picked).toBe("llama3.2:3b");
  });

  it("falls back to most recently modified chat model", () => {
    const picked = pickPreferredOllamaModel([
      { name: "custom-coder:7b", family: "qwen2", modified: "2026-01-01T00:00:00Z" },
      { name: "my-finetune:latest", family: "llama", modified: "2026-06-01T00:00:00Z" },
      { name: "nomic-embed-text", modified: "2026-07-01T00:00:00Z" },
    ]);
    expect(picked).toBe("my-finetune:latest");
  });

  it("returns null when only embeddings are present", () => {
    expect(pickPreferredOllamaModel([{ name: "nomic-embed-text" }])).toBeNull();
  });
});
