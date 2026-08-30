import { getConvDb } from ".";

// A maintained, rolling summary of a conversation's older turns. `covered_count`
// is how many leading messages (user/assistant/tool) the summary already folds
// in, so it can be extended incrementally instead of re-summarized every turn.
export type ConversationSummary = {
  conversation_id: string;
  summary: string;
  covered_count: number;
  updated_at: number;
};

export function getConversationSummary(conversationId: string): ConversationSummary | null {
  return (
    (getConvDb()
      .prepare("SELECT * FROM conversation_summaries WHERE conversation_id=?")
      .get(conversationId) as ConversationSummary | undefined) || null
  );
}

/** Most recently updated (non-deleted) conversation ids — for idle precompute. */
export function listRecentConversationIds(limit = 5): string[] {
  return (
    getConvDb()
      .prepare("SELECT id FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as { id: string }[]
  ).map((r) => r.id);
}

export function upsertConversationSummary(conversationId: string, summary: string, coveredCount: number): void {
  getConvDb()
    .prepare(
      "INSERT INTO conversation_summaries (conversation_id, summary, covered_count, updated_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary, covered_count=excluded.covered_count, updated_at=excluded.updated_at"
    )
    .run(conversationId, summary, coveredCount, Date.now());
}

export function deleteConversationSummary(conversationId: string): void {
  getConvDb().prepare("DELETE FROM conversation_summaries WHERE conversation_id=?").run(conversationId);
}
