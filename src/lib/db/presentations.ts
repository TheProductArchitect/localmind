import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getConfigDb } from ".";
import { PRESENTATIONS_DIR, ensureDataDir } from "../paths";
import {
  parseDeckMarkdown,
  serializeDeckMarkdown,
  outlineToSlides,
  deckToHtml,
  type Deck,
  type Slide,
} from "../presentations/deck";

export type PresentationRow = {
  id: string;
  title: string;
  owner_user_id: string | null;
  status: string;
  deck_path: string;
  slide_count: number;
  created_at: number;
  updated_at: number;
};

function deckDir(id: string): string {
  ensureDataDir();
  const d = path.join(PRESENTATIONS_DIR, id);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

export function listPresentations(): PresentationRow[] {
  return getConfigDb()
    .prepare("SELECT * FROM presentations ORDER BY updated_at DESC")
    .all() as PresentationRow[];
}

export function getPresentation(id: string): PresentationRow | null {
  return (
    (getConfigDb().prepare("SELECT * FROM presentations WHERE id=?").get(id) as PresentationRow) ||
    null
  );
}

export function readDeck(id: string): Deck | null {
  const row = getPresentation(id);
  if (!row) return null;
  const abs = path.join(PRESENTATIONS_DIR, row.deck_path);
  if (!fs.existsSync(abs)) return { title: row.title, slides: [] };
  return parseDeckMarkdown(fs.readFileSync(abs, "utf8"));
}

export function createPresentation(o: {
  title: string;
  outline?: string;
  slides?: Slide[];
  owner?: string | null;
}): PresentationRow {
  const id = nanoid(12);
  const slides = o.slides?.length
    ? o.slides
    : o.outline
      ? outlineToSlides(o.outline)
      : [{ title: o.title, bullets: ["Add content"], body: "" }];
  const deck: Deck = { title: o.title, slides };
  const dir = deckDir(id);
  const rel = path.join(id, "deck.md");
  fs.writeFileSync(path.join(dir, "deck.md"), serializeDeckMarkdown(deck), "utf8");
  const now = Date.now();
  getConfigDb()
    .prepare(
      "INSERT INTO presentations (id,title,owner_user_id,status,deck_path,slide_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(id, o.title, o.owner ?? null, "draft", rel, slides.length, now, now);
  return getPresentation(id)!;
}

export function updatePresentationSlides(
  id: string,
  slides: Slide[],
  title?: string
): PresentationRow | null {
  const row = getPresentation(id);
  if (!row) return null;
  const deck = readDeck(id) || { title: row.title, slides: [] };
  if (title) deck.title = title;
  deck.slides = slides;
  const abs = path.join(PRESENTATIONS_DIR, row.deck_path);
  fs.writeFileSync(abs, serializeDeckMarkdown(deck), "utf8");
  getConfigDb()
    .prepare(
      "UPDATE presentations SET title=?, slide_count=?, status='draft', updated_at=? WHERE id=?"
    )
    .run(deck.title, slides.length, Date.now(), id);
  return getPresentation(id);
}

export async function exportPresentation(
  id: string,
  format: "pptx" | "pdf" | "html"
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const row = getPresentation(id);
  if (!row) return { ok: false, error: "not found" };
  const deck = readDeck(id);
  if (!deck) return { ok: false, error: "deck missing" };
  const dir = deckDir(id);

  if (format === "html" || format === "pdf") {
    const htmlPath = path.join(dir, "export.html");
    const html = deckToHtml(deck);
    fs.writeFileSync(htmlPath, html, "utf8");
    if (format === "html") {
      getConfigDb()
        .prepare("UPDATE presentations SET status='exported', updated_at=? WHERE id=?")
        .run(Date.now(), id);
      return { ok: true, path: htmlPath };
    }
    // Real PDF via Playwright Chromium; fall back to printable HTML companion.
    const pdfPath = path.join(dir, "export.pdf");
    try {
      await import("../playwright-path");
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({
          path: pdfPath,
          format: "A4",
          printBackground: true,
          margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
        });
      } finally {
        await browser.close().catch(() => {});
      }
      getConfigDb()
        .prepare("UPDATE presentations SET status='exported', updated_at=? WHERE id=?")
        .run(Date.now(), id);
      return { ok: true, path: pdfPath };
    } catch (e: any) {
      const pdfNote = path.join(dir, "export.pdf.html");
      fs.writeFileSync(pdfNote, html, "utf8");
      getConfigDb()
        .prepare("UPDATE presentations SET status='exported', updated_at=? WHERE id=?")
        .run(Date.now(), id);
      return {
        ok: true,
        path: pdfNote,
      };
    }
  }

  try {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.title = deck.title;
    for (const s of deck.slides) {
      const slide = pptx.addSlide();
      slide.addText(s.title, { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true });
      if (s.bullets.length) {
        slide.addText(
          s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
          { x: 0.7, y: 1.5, w: 8.5, h: 4, fontSize: 18 }
        );
      }
      if (s.body) {
        slide.addText(s.body, { x: 0.7, y: 5.5, w: 8.5, h: 1, fontSize: 14, color: "666666" });
      }
    }
    const out = path.join(dir, "export.pptx");
    await pptx.writeFile({ fileName: out });
    getConfigDb()
      .prepare("UPDATE presentations SET status='exported', updated_at=? WHERE id=?")
      .run(Date.now(), id);
    return { ok: true, path: out };
  } catch (e: any) {
    return { ok: false, error: e?.message || "pptx export failed" };
  }
}
