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

export function upsertConversationSummary(conversationId: string, summary: string, coveredCount: number): void {
  getConvDb()
    .prepare(
      "INSERT INTO conversation_summaries (conversation_id, summary, covered_count, updated_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary, covered_count=excluded.covered_count, updated_at=excluded.updated_at"
    )
    .run(conversationId, summary, coveredCount, Date.now());
}
