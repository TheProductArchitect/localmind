import { describe, it, expect } from "vitest";

const URL_RE = /https?:\/\/[^\s)]+/gi;

function extractUrls(searchOutput: string, limit: number): string[] {
  const urls = searchOutput.match(URL_RE) || [];
  return [...new Set(urls.map((u) => u.replace(/[.,;]+$/, "")))].slice(0, limit);
}

describe("web_research URL extraction", () => {
  it("extracts unique URLs from search output", () => {
    const text = `- Article One
  https://example.com/a
  Snippet

- Article Two
  https://example.com/b
  More text

- Duplicate
  https://example.com/a`;
    expect(extractUrls(text, 3)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("respects max_pages limit", () => {
    const text = "https://a.com https://b.com https://c.com https://d.com";
    expect(extractUrls(text, 2)).toHaveLength(2);
  });
});
