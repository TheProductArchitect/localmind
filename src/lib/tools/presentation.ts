import {
  listPresentations,
  getPresentation,
  createPresentation,
  updatePresentationSlides,
  exportPresentation,
  readDeck,
} from "../db/presentations";
import type { Slide } from "../presentations/deck";
import type { Tool } from "./types";

export const presentationTool: Tool = {
  actionType: "write_files",
  version: "1",
  classify: (i) => {
    const op = String(i.operation || "list").toLowerCase();
    if (op === "list" || op === "get") return "read_files";
    return "write_files";
  },
  preview: (i) => {
    const op = String(i.operation || "list");
    if (op === "create") return `Create presentation: ${i.title || "(untitled)"}`;
    if (op === "export") return `Export presentation ${i.id} as ${i.format || "pptx"}`;
    return `Presentation ${op}`;
  },
  definition: {
    name: "presentation",
    description:
      "Create and iterate slide decks as local Markdown artifacts, then export PPTX or printable HTML/PDF. Use for presentations the user asks you to build.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "create | list | get | update_slides | export",
        },
        id: { type: "string" },
        title: { type: "string" },
        outline: {
          type: "string",
          description: "Freeform outline; turned into slides on create",
        },
        slides: {
          type: "array",
          description: "Array of { title, bullets[], body }",
          items: { type: "object" },
        },
        format: { type: "string", description: "pptx | pdf | html" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const op = String(input.operation || "list").toLowerCase();

    if (op === "list") {
      const rows = listPresentations().map((p) => ({
        id: p.id,
        title: p.title,
        slides: p.slide_count,
        status: p.status,
        updated_at: p.updated_at,
      }));
      return { ok: true, output: JSON.stringify(rows, null, 2), summary: `${rows.length} decks` };
    }

    if (op === "create") {
      const title = String(input.title || "Untitled presentation").trim();
      const slides = Array.isArray(input.slides) ? (input.slides as Slide[]) : undefined;
      const row = createPresentation({
        title,
        outline: input.outline ? String(input.outline) : undefined,
        slides,
      });
      return {
        ok: true,
        output: `Created presentation ${row.id} (${row.slide_count} slides). Open /presentations?id=${row.id}`,
        summary: `created ${row.id}`,
      };
    }

    if (op === "get") {
      const id = String(input.id || "");
      const row = getPresentation(id);
      if (!row) return { ok: false, output: "not found", summary: "missing" };
      const deck = readDeck(id);
      return {
        ok: true,
        output: JSON.stringify({ ...row, deck }, null, 2),
        summary: row.title,
      };
    }

    if (op === "update_slides") {
      const id = String(input.id || "");
      if (!Array.isArray(input.slides)) {
        return { ok: false, output: "slides array required", summary: "bad input" };
      }
      const row = updatePresentationSlides(
        id,
        input.slides as Slide[],
        input.title ? String(input.title) : undefined
      );
      if (!row) return { ok: false, output: "not found", summary: "missing" };
      return {
        ok: true,
        output: `Updated ${row.id} → ${row.slide_count} slides`,
        summary: "updated",
      };
    }

    if (op === "export") {
      const id = String(input.id || "");
      const format = (String(input.format || "pptx").toLowerCase() as "pptx" | "pdf" | "html");
      const result = await exportPresentation(id, format);
      if (!result.ok) return { ok: false, output: result.error, summary: "export failed" };
      return {
        ok: true,
        output: `Exported ${format} to ${result.path}`,
        summary: `exported ${format}`,
      };
    }

    return { ok: false, output: `Unknown operation ${op}`, summary: "bad op" };
  },
};
