/**
 * POST /api/chat/resume — clear a conversation's loop-guard suspension.
 *
 * The loop guard suspends a conversation when the same (tool, input) has
 * fired MAX_REPEATS times within the window. The suspension persists across
 * process restarts via the conversation_loop_state table. This endpoint
 * lets the user explicitly clear it once they've reviewed what happened.
 *
 * Body: { conversation_id }
 * Response: { resumed: boolean, message: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getConversation } from "@/lib/db/queries";
import { isSuspended, resume } from "@/lib/agent/loop-guard";

export const runtime = "nodejs";

const Body = z.object({ conversation_id: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const conv = getConversation(parsed.data.conversation_id);
  const user = currentUser(req);
  if (!conv || !user) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conv.owner_user_id && conv.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const state = isSuspended(parsed.data.conversation_id);
  if (!state.suspended) {
    return NextResponse.json({ resumed: false, message: "This conversation isn't suspended." });
  }

  resume(parsed.data.conversation_id);
  return NextResponse.json({
    resumed: true,
    message: `Suspension cleared. Previously: ${state.reason ?? "loop detected"}. The next chat turn will proceed normally.`,
  });
}

export async function GET(req: NextRequest) {
  // Convenience: check suspension status without resuming. Useful for the
  // chat UI to show "this conversation is suspended" banner.
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  if (!conversationId) return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  const state = isSuspended(conversationId);
  return NextResponse.json(state);
}
