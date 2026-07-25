import { describe, it, expect } from "vitest";
import {
  parseDeckMarkdown,
  serializeDeckMarkdown,
  outlineToSlides,
  deckToHtml,
} from "../src/lib/presentations/deck";

describe("presentation deck markdown", () => {
  it("round-trips title and slides", () => {
    const md = `---
title: "Q3 Plan"
---

# Agenda
- Goals
- Timeline

---

# Next steps
- Ship v3
`;
    const deck = parseDeckMarkdown(md);
    expect(deck.title).toBe("Q3 Plan");
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].bullets).toContain("Goals");
    const again = parseDeckMarkdown(serializeDeckMarkdown(deck));
    expect(again.slides[1].title).toBe("Next steps");
  });

  it("builds slides from an outline", () => {
    const slides = outlineToSlides("# Intro\n- a\n- b\n# Close\n- thanks");
    expect(slides.length).toBeGreaterThanOrEqual(2);
    expect(slides[0].title.toLowerCase()).toMatch(/intro/);
  });

  it("renders printable html", () => {
    const html = deckToHtml({
      title: "Demo",
      slides: [{ title: "Hello", bullets: ["world"], body: "" }],
    });
    expect(html).toContain("Hello");
    expect(html).toContain("<li>world</li>");
  });
});
