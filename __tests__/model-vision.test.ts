import { describe, expect, it } from "vitest";
import { modelNameSuggestsVision, modelSupportsVisionSync } from "@/lib/models/vision";

describe("model vision heuristics", () => {
  it("detects common vision model names", () => {
    expect(modelNameSuggestsVision("llava:7b")).toBe(true);
    expect(modelNameSuggestsVision("llama3.2-vision")).toBe(true);
    expect(modelNameSuggestsVision("qwen2.5-vl:7b")).toBe(true);
    expect(modelNameSuggestsVision("gemma4:26b")).toBe(true);
    expect(modelNameSuggestsVision("gpt-4o")).toBe(true);
    expect(modelNameSuggestsVision("claude-3-5-sonnet")).toBe(true);
  });

  it("rejects plain chat models", () => {
    expect(modelNameSuggestsVision("llama3.2:3b")).toBe(false);
    expect(modelNameSuggestsVision("mistral:7b")).toBe(false);
    expect(modelNameSuggestsVision("qwen3-coder-next:q4_K_M")).toBe(false);
  });

  it("honours explicit capabilities", () => {
    expect(modelSupportsVisionSync({ name: "custom", capabilities: ["vision"] })).toBe(true);
    expect(modelSupportsVisionSync({ name: "custom", capabilities: ["completion"] })).toBe(false);
  });
});
