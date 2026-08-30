import { describe, expect, it } from "vitest";

/**
 * Lightweight unit coverage for report analysis JSON normalization logic
 * (mirrors extract/normalize used by analyze-improvement).
 */

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return JSON.parse(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("no json");
}

describe("improvement report JSON extract", () => {
  it("parses fenced json", () => {
    const j = extractJson('Here you go:\n```json\n{"title":"T","severity":"high","summary":"s","suggestions":["a"],"related_areas":[]}\n```');
    expect((j as any).title).toBe("T");
    expect((j as any).severity).toBe("high");
  });

  it("parses raw object with prose wrapper", () => {
    const j = extractJson('Sure. {"title":"X","summary":"y","severity":"low","suggestions":[],"related_areas":["chat"]} thanks');
    expect((j as any).related_areas).toEqual(["chat"]);
  });
});
