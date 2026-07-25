/**
 * POST /api/fleet/peers/[id]/chat
 *
 * Drive a chat session on a paired peer. Streams progressive status + live
 * token deltas over SSE (fleet NDJSON under the hood when peers support it).
 *
 * Body: { conversation_id: string, message: string, persona_id?: string }
 * SSE events: { type: "status", phase }, { type: "token", text },
 *             { type: "done", reply, … }, { type: "error", message }
 */

import { NextRequest } from "next/server";
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
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const peer = getPeer(params.id);
  if (!peer || peer.trusted !== 1) {
    return new Response(JSON.stringify({ error: "Unknown or untrusted peer." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload.", issues: parsed.error.issues }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const peerLabel = peer.label || peer.peer_node_id.slice(0, 12);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      write({ type: "status", phase: "relay_started", peer_label: peerLabel });
      try {
        const result = await relayChatToPeer({
          peer_node_id: params.id,
          conversation_id: parsed.data.conversation_id,
          message: parsed.data.message,
          persona_id: parsed.data.persona_id,
          stream_tokens: true,
          onToken: (text) => {
            write({ type: "status", phase: "receiving", peer_label: peerLabel });
            write({ type: "token", text });
          },
        });
        if (!result.ok) {
          write({
            type: "error",
            message: result.reason,
            local_audit_id: result.local_audit_id,
          });
        } else {
          write({ type: "status", phase: "receiving", peer_label: peerLabel });
          write({
            type: "done",
            reply: result.reply,
            executor_conversation_id: result.executor_conversation_id,
            peer_audit_id: result.peer_audit_id,
            local_audit_id: result.local_audit_id,
            peer_label: peerLabel,
          });
        }
      } catch (e) {
        write({ type: "error", message: (e as Error).message || "Relay failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
