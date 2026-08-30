import {
  getConversation,
  getMessages,
  searchConversationHistory,
  type ConversationHistoryMatch,
} from "../db/queries";
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
  version: "2",
  cacheable: () => true,
  preview: (i) =>
    `Recall from ${i.scope === "current" ? "this conversation" : "conversation history"}: ${i.query}`,
  definition: {
    name: "recall",
    description:
      "Search earlier messages by keyword, including prior conversations. Use for questions like \"what did we decide last week?\" or details no longer in the active context. Defaults to all conversations owned by the current user; set scope=current for this conversation only.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for in earlier messages" },
        limit: { type: "number", description: "Max messages to return (default 5)" },
        scope: {
          type: "string",
          enum: ["all", "current"],
          description: "Search all owned conversations (default) or only the current conversation",
        },
      },
      required: ["query"],
    },
  },
  async execute(input, ctx) {
    const query = String(input.query || "").trim();
    if (!query) return { ok: false, output: "query is required" };
    const limit = Math.max(1, Math.min(Number(input.limit) || 5, 20));
    const scope = input.scope === "current" ? "current" : "all";

    if (scope === "current") {
      const msgs = getMessages(ctx.conversationId).filter(
        (m) => m.role === "user" || m.role === "assistant"
      );
      const ranked = msgs
        .map((m, idx) => ({
          idx,
          role: m.role,
          content: m.content || "",
          s: score(query, m.content || ""),
        }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit);

      if (ranked.length === 0) {
        return {
          ok: true,
          output: `No earlier messages in this conversation match "${query}".`,
          summary: "no matches",
        };
      }
      ranked.sort((a, b) => a.idx - b.idx);
      const output = ranked
        .map((r) => `[#${r.idx} ${r.role}] ${compact(r.content)}`)
        .join("\n\n");
      return { ok: true, output, summary: `recalled ${ranked.length} message(s)` };
    }

    const ownerUserId = getConversation(ctx.conversationId)?.owner_user_id ?? null;
    const candidates = searchConversationHistory(query, {
      ownerUserId,
      limit: Math.max(limit * 8, 40),
    });
    const ranked = candidates
      .map((match) => ({ match, s: score(query, match.content) }))
      .filter((row) => row.s > 0)
      .sort((a, b) => b.s - a.s || b.match.created_at - a.match.created_at)
      .slice(0, limit);

    if (ranked.length === 0) {
      return {
        ok: true,
        output: `No messages in your conversation history match "${query}".`,
        summary: "no matches",
      };
    }
    const output = ranked.map(({ match }) => renderHistoryMatch(match)).join("\n\n");
    return {
      ok: true,
      output,
      summary: `recalled ${ranked.length} message(s) across conversation history`,
    };
  },
};

function compact(content: string): string {
  return content.replace(/\s+/g, " ").slice(0, 600);
}

function renderHistoryMatch(match: ConversationHistoryMatch): string {
  const when = new Date(match.created_at).toISOString();
  return `[${when} · ${match.conversation_title} · ${match.role} · conversation:${match.conversation_id}] ${compact(match.content)}`;
}
