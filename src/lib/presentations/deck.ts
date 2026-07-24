export type Slide = {
  title: string;
  bullets: string[];
  body: string;
};

export type Deck = {
  title: string;
  theme?: string;
  slides: Slide[];
};

/** Parse Markdown deck: YAML-ish frontmatter optional, slides separated by ---. */
export function parseDeckMarkdown(md: string): Deck {
  let text = String(md || "").trim();
  let title = "Untitled presentation";
  let theme: string | undefined;

  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = text.slice(3, end).trim();
      text = text.slice(end + 4).trim();
      for (const line of fm.split("\n")) {
        const m = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (!m) continue;
        if (m[1] === "title") title = m[2].trim().replace(/^["']|["']$/g, "");
        if (m[1] === "theme") theme = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  const rawSlides = text.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  const slides: Slide[] = rawSlides.map((block) => {
    const lines = block.split("\n");
    let slideTitle = "";
    const bullets: string[] = [];
    const bodyLines: string[] = [];
    for (const line of lines) {
      const h = line.match(/^#\s+(.+)/);
      if (h && !slideTitle) {
        slideTitle = h[1].trim();
        continue;
      }
      const b = line.match(/^[-*]\s+(.+)/);
      if (b) {
        bullets.push(b[1].trim());
        continue;
      }
      if (line.trim()) bodyLines.push(line.trim());
    }
    return {
      title: slideTitle || "Slide",
      bullets,
      body: bodyLines.join("\n"),
    };
  });

  if (!slides.length) {
    slides.push({ title: title, bullets: [], body: "" });
  }

  return { title, theme, slides };
}

export function serializeDeckMarkdown(deck: Deck): string {
  const fm = [`---`, `title: ${JSON.stringify(deck.title)}`];
  if (deck.theme) fm.push(`theme: ${JSON.stringify(deck.theme)}`);
  fm.push(`---`, "");
  const parts = deck.slides.map((s) => {
    const lines = [`# ${s.title}`];
    for (const b of s.bullets) lines.push(`- ${b}`);
    if (s.body) {
      lines.push("");
      lines.push(s.body);
    }
    return lines.join("\n");
  });
  return fm.join("\n") + parts.join("\n\n---\n\n") + "\n";
}

export function outlineToSlides(outline: string): Slide[] {
  const lines = String(outline || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [{ title: "Overview", bullets: ["Add content"], body: "" }];
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  for (const line of lines) {
    const h = line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "");
    if (/^#+\s/.test(line) || (!line.startsWith("-") && !line.startsWith("*") && line.length < 80)) {
      if (cur) slides.push(cur);
      cur = { title: h, bullets: [], body: "" };
    } else {
      if (!cur) cur = { title: "Overview", bullets: [], body: "" };
      cur.bullets.push(h.replace(/^[-*]\s*/, ""));
    }
  }
  if (cur) slides.push(cur);
  return slides.length ? slides : [{ title: "Overview", bullets: lines.slice(0, 8), body: "" }];
}

export function deckToHtml(deck: Deck): string {
  const slidesHtml = deck.slides
    .map(
      (s) => `
<section class="slide">
  <h1>${escapeHtml(s.title)}</h1>
  ${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
  ${s.body ? `<p>${escapeHtml(s.body)}</p>` : ""}
</section>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(deck.title)}</title>
<style>
  body { font-family: Georgia, serif; margin: 0; background: #111; color: #f5f5f5; }
  .slide { page-break-after: always; min-height: 100vh; padding: 12vh 10vw; box-sizing: border-box; }
  h1 { font-size: 2.4rem; margin: 0 0 1.5rem; }
  ul { font-size: 1.25rem; line-height: 1.5; }
  p { font-size: 1.1rem; opacity: 0.9; }
  @media print { .slide { min-height: auto; height: 100vh; } }
</style></head><body>
${slidesHtml}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
