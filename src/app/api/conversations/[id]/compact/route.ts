import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  getMessages,
  getSettings,
  replaceConversationMessages,
} from "@/lib/db/queries";
import { deleteConversationSummary } from "@/lib/db/conversation-summary";
import { ensureConversationSummary } from "@/lib/agent/history-summary";
import { recentWindowSize, splitHistory } from "@/lib/agent/history-context";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { approxTokens } from "@/lib/utils";

export const runtime = "nodejs";

function authorised(req: NextRequest, id: string) {
  const user = currentUser(req);
  const conv = getConversation(id);
  if (!user || !conv) return null;
  if (conv.owner_user_id && conv.owner_user_id !== user.id && !isOwner(req)) return null;
  return conv;
}

/**
 * POST /api/conversations/[id]/compact
 *
 * Summarize older turns, keep the recent window verbatim, and replace the
 * stored history with a short "compacted" preamble + recent messages so the
 * next model call fits a smaller context.
 */
export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const conv = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const msgs = getMessages(params.id);
  const recentN = recentWindowSize();
  if (msgs.length <= recentN) {
    return NextResponse.json({
      ok: true,
      compacted: false,
      reason: "Conversation is already within the recent window.",
      kept: msgs.length,
    });
  }

  const history = msgs.map((m) => ({
    role: m.role,
    content: m.content,
    id: m.id,
  }));
  const { older, recent } = splitHistory(history, recentN);
  if (older.length === 0) {
    return NextResponse.json({ ok: true, compacted: false, reason: "Nothing to compact.", kept: msgs.length });
  }

  const settings = getSettings();
  const model = conv.model_name || settings.active_model;
  if (!model) {
    return NextResponse.json(
      { error: "No AI model is selected. Pick a model before compacting." },
      { status: 400 }
    );
  }

  const contextWindow = Number(settings.context_window) || 8192;
  const summary = await ensureConversationSummary(params.id, older, {
    model,
    contextWindow,
    force: true,
  });

  const preamble = summary
    ? `[Earlier conversation — compacted]\n${summary}\n\n(Details from earlier turns were summarized to free context. Ask me to recall something specific if needed.)`
    : `[Earlier conversation — compacted]\n(${older.length} older messages were dropped to free context.)`;

  const recentRows = recent.map((r) => {
    const full = msgs.find((m) => m.id === r.id)!;
    return {
      role: full.role,
      content: full.content,
      token_count: full.token_count,
      parent_message_id: full.parent_message_id,
      attachments: full.attachments,
      origin_node_id: full.origin_node_id,
      origin_label: full.origin_label,
    };
  });

  replaceConversationMessages(params.id, [
    {
      role: "user",
      content: preamble,
      token_count: approxTokens(preamble),
      parent_message_id: null,
      attachments: null,
      origin_node_id: null,
      origin_label: null,
    },
    ...recentRows,
  ]);
  // Summary is now inlined as a message — drop the rolling table entry so the
  // engine doesn't double-inject it.
  deleteConversationSummary(params.id);

  return NextResponse.json({
    ok: true,
    compacted: true,
    dropped: older.length,
    kept: recentRows.length + 1,
  });
}
