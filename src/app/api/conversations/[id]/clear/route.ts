import { NextRequest, NextResponse } from "next/server";
import { getConversation, clearConversationMessages } from "@/lib/db/queries";
import { deleteConversationSummary } from "@/lib/db/conversation-summary";
import { currentUser, isOwner } from "@/lib/auth/identity";

export const runtime = "nodejs";

function authorised(req: NextRequest, id: string) {
  const user = currentUser(req);
  const conv = getConversation(id);
  if (!user || !conv) return null;
  if (conv.owner_user_id && conv.owner_user_id !== user.id && !isOwner(req)) return null;
  return conv;
}

/**
 * POST /api/conversations/[id]/clear — wipe messages + rolling summary, keep the chat.
 */
export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const conv = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const deleted = clearConversationMessages(params.id);
  deleteConversationSummary(params.id);
  return NextResponse.json({ ok: true, deleted });
}
