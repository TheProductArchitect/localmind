import { getProvider } from "../providers";
import { getConversationSummary, upsertConversationSummary } from "../db/conversation-summary";
import type { HistoryMsg } from "./history-context";

const SUMMARY_SYSTEM =
  "You maintain a running summary of a conversation between a user and an assistant. " +
  "Update the summary to incorporate the new turns, preserving key facts, decisions, names, numbers, and file paths. " +
  "Write in plain prose, third person, and keep it under 400 words.";

/**
 * Ensure a conversation's rolling summary covers all `older` messages, extending
 * it incrementally (only summarizing the turns not yet covered). Returns the
 * summary text, or null if none could be produced (caller falls back to raw
 * history). Cheap on most turns — it only calls the model when the covered
 * window has actually advanced.
 */
export async function ensureConversationSummary(
  conversationId: string,
  older: HistoryMsg[],
  opts: { model: string; signal?: AbortSignal; contextWindow: number }
): Promise<string | null> {
  const stored = getConversationSummary(conversationId);
  const covered = stored?.covered_count ?? 0;
  if (older.length === 0) return stored?.summary ?? null;
  if (stored && covered >= older.length) return stored.summary; // already current

  const fresh = older.slice(covered);
  if (fresh.length === 0) return stored?.summary ?? null;

  const transcript = fresh
    .map((m) => `${m.role}: ${String(m.content ?? "").slice(0, 1500)}`)
    .join("\n");
  const userContent = (stored?.summary ? `Current summary:\n${stored.summary}\n\n` : "") + `New turns:\n${transcript}`;

  try {
    let summary = "";
    for await (const d of getProvider().chat({
      model: opts.model,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: userContent },
      ],
      tools: [],
      signal: opts.signal,
      contextWindow: opts.contextWindow,
    })) {
      if (d.type === "text") summary += d.delta;
    }
    summary = summary.trim();
    if (!summary) return stored?.summary ?? null;
    upsertConversationSummary(conversationId, summary, older.length);
    return summary;
  } catch {
    return stored?.summary ?? null;
  }
}
