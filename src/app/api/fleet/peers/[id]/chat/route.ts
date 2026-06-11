/**
 * POST /api/fleet/peers/[id]/chat
 *
 * Drive a chat session on a paired peer. The peer must have explicitly opted
 * in (their accept_chat_relay flag) — otherwise the executor will refuse.
 *
 * Body: { conversation_id: string, message: string, persona_id?: string }
 * Returns: { reply, executor_conversation_id, peer_audit_id, local_audit_id }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/identity";
import { getPeer } from "@/lib/db/fleet";
import { relayChatToPeer } from "@/lib/fleet/chat-relay-initiator";

export const runtime = "nodejs";

const Body = z.object({
  conversation_id: z.string().min(1),
  message: z.string().min(1).max(64 * 1024),
  persona_id: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const peer = getPeer(params.id);
  if (!peer || peer.trusted !== 1) {
    return NextResponse.json({ error: "Unknown or untrusted peer." }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await relayChatToPeer({
    peer_node_id: params.id,
    conversation_id: parsed.data.conversation_id,
    message: parsed.data.message,
    persona_id: parsed.data.persona_id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, local_audit_id: result.local_audit_id },
      { status: 502 }
    );
  }

  return NextResponse.json({
    reply: result.reply,
    executor_conversation_id: result.executor_conversation_id,
    peer_audit_id: result.peer_audit_id,
    local_audit_id: result.local_audit_id,
  });
}
