/**
 * SSE feed of the agent's actions in a granted browse session, so the Browse
 * chrome can narrate them above the page (where web content can't forge it).
 *
 * Push-based: the session layer publishes each action as it happens.
 */

import { NextRequest } from "next/server";
import { getAgentActivity, subscribeAgentActivity, type AgentActivity } from "@/lib/browse/agent-activity";
import { getBrowseSession } from "@/lib/browse/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
const MAX_DURATION_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();
  if (!sessionId) return new Response("session_id required", { status: 400 });
  // Only a live session's feed is readable — a stale id must not leak history.
  if (!getBrowseSession(sessionId)) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      for (const entry of getAgentActivity(sessionId).slice(-5)) send("activity", entry);

      const unsubscribe = subscribeAgentActivity(sessionId, (a: AgentActivity) => send("activity", a));
      const keepalive = setInterval(() => send("ping", { at: Date.now() }), KEEPALIVE_MS);
      const deadline = setTimeout(() => finish(), MAX_DURATION_MS);

      function finish() {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepalive);
        clearTimeout(deadline);
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
