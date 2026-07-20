import { getMessages } from "../db/queries";
import type { Tool } from "./types";

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  );
}

// Score a message against the query: keyword overlap + a boost for a direct
// substring hit. Cheap and local; no embeddings needed.
function score(query: string, text: string): number {
  const q = tokenize(query);
  const t = tokenize(text);
  if (q.size === 0 || t.size === 0) return 0;
  let inter = 0;
  for (const w of q) if (t.has(w)) inter++;
  const overlap = inter / q.size;
  const substring = text.toLowerCase().includes(query.toLowerCase().trim()) ? 0.5 : 0;
  return overlap + substring;
}

export const recallTool: Tool = {
  actionType: "memory_read",
  version: "1",
  cacheable: () => true,
  preview: (i) => `Recall from this conversation: ${i.query}`,
  definition: {
    name: "recall",
    description:
      "Search THIS conversation's earlier messages by keyword to pull back specific past turns that are no longer in the recent context window (older history is summarized, not included verbatim). Use when you need a detail from earlier in the conversation.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for in earlier messages" },
        limit: { type: "number", description: "Max messages to return (default 5)" },
      },
      required: ["query"],
    },
  },
  async execute(input, ctx) {
    const query = String(input.query || "").trim();
    if (!query) return { ok: false, output: "query is required" };
    const limit = Math.max(1, Math.min(Number(input.limit) || 5, 20));

    const msgs = getMessages(ctx.conversationId).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    const ranked = msgs
      .map((m, idx) => ({ idx, role: m.role, content: m.content || "", s: score(query, m.content || "") }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit);

    if (ranked.length === 0) {
      return { ok: true, output: `No earlier messages in this conversation match "${query}".`, summary: "no matches" };
    }
    // Return in chronological order for readability.
    ranked.sort((a, b) => a.idx - b.idx);
    const out = ranked
      .map((r) => `[#${r.idx} ${r.role}] ${r.content.replace(/\s+/g, " ").slice(0, 600)}`)
      .join("\n\n");
    return { ok: true, output: out, summary: `recalled ${ranked.length} message(s)` };
  },
};
