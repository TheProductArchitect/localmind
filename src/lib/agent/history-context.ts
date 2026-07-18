/**
 * Intelligent conversation history.
 *
 * Rather than dumping every past message into the model's context, history is
 * assembled in three layers:
 *   1. a verbatim window of the most recent messages (high-signal, cheap),
 *   2. a maintained rolling *summary* of everything older (see history-summary),
 *   3. on-demand retrieval of specific older messages via the `recall` tool.
 *
 * This module owns layer 1's boundary logic — pure and unit-tested.
 */

export type HistoryMsg = { role: string; content?: string; [k: string]: unknown };

/** How many recent messages to keep verbatim. Configurable, not hard-coded. */
export function recentWindowSize(): number {
  const n = Number(process.env.LM_HISTORY_RECENT_MESSAGES);
  return Number.isFinite(n) && n > 0 ? n : 16;
}

/**
 * Split non-system history into { older, recent }. `recent` keeps the last
 * `recentCount` messages verbatim; `older` is everything before it (to be
 * summarized). The cut is nudged back so `recent` never *begins* with a `tool`
 * message — a tool result must stay paired with the assistant turn that
 * requested it, or providers reject the sequence.
 */
export function splitHistory<T extends HistoryMsg>(
  messages: T[],
  recentCount: number
): { older: T[]; recent: T[] } {
  if (messages.length <= recentCount) return { older: [], recent: messages };
  let start = messages.length - recentCount;
  while (start > 0 && messages[start]?.role === "tool") start--;
  return { older: messages.slice(0, start), recent: messages.slice(start) };
}
