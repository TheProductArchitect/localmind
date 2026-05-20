import { semanticSearch } from "../knowledge/search";
import { createNote, listNotes } from "../db/knowledge";
import type { Tool } from "./types";

export const knowledgeTool: Tool = {
  actionType: "memory_read",
  classify: (i) => (i.operation === "create_note" ? "memory_write" : "memory_read"),
  preview: (i) =>
    i.operation === "create_note" ? `Create note: ${i.title}` : `Search knowledge base: ${i.query}`,
  definition: {
    name: "knowledge_base",
    description:
      "Search the user's knowledge base (ingested documents and notes) by meaning, or create a new note. Operations: search, list_notes, create_note.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["search", "list_notes", "create_note"] },
        query: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    if (input.operation === "search") {
      const results = await semanticSearch(String(input.query || ""), 5);
      if (!results.length) return { ok: true, output: "No relevant knowledge found.", summary: "kb search" };
      return {
        ok: true,
        output: results
          .map((r) => `[${r.documentName} · ${(r.score * 100).toFixed(0)}%]\n${r.text}`)
          .join("\n\n"),
        summary: `kb search "${input.query}" — ${results.length} hits`,
      };
    }
    if (input.operation === "list_notes") {
      const notes = listNotes();
      return {
        ok: true,
        output: notes.length ? notes.map((n) => `- ${n.title}`).join("\n") : "(no notes)",
        summary: `${notes.length} notes`,
      };
    }
    if (input.operation === "create_note") {
      if (!input.title) return { ok: false, output: "title required" };
      const note = createNote({
        title: String(input.title),
        content: String(input.content || ""),
        source_conversation_id: ctx.conversationId,
      });
      return { ok: true, output: `Created note "${note.title}"`, summary: `note created` };
    }
    return { ok: false, output: `Unknown operation: ${input.operation}` };
  },
};
