import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent/engine";
import { devpmSystemPrefix } from "@/lib/devpm";
import { startSession, getSession, addWriter, removeWriter, pushEvent, finishSession } from "@/lib/agent/sse-hub";
import { getMessages } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export async function POST(req: NextRequest) {
  const { conversationId, message, regenerate, persona, browseSessionId, images } = await req.json();
  if (!conversationId || (!regenerate && typeof message !== "string")) {
    return new Response("conversationId and message are required", { status: 400 });
  }

  // Multimodal image attachments: { name?, mime, data(base64) }. Capped in
  // count and size so a stray upload can't blow up the request or the DB.
  const attachments = Array.isArray(images)
    ? images
        .filter((a: any) => a && typeof a.data === "string" && typeof a.mime === "string" && a.mime.startsWith("image/"))
        .slice(0, 6)
        .map((a: any) => ({ name: typeof a.name === "string" ? a.name.slice(0, 200) : undefined, mime: a.mime, data: a.data }))
    : undefined;

  let browsePrefix: string | undefined;
  if (typeof browseSessionId === "string" && browseSessionId.trim()) {
    const { linkBrowseSession, buildBrowseContextPrefix } = await import("@/lib/browse/session");
    linkBrowseSession(conversationId, browseSessionId.trim());
    browsePrefix = await buildBrowseContextPrefix(browseSessionId.trim());
  }
  const devpmPrefix = persona === "devpm" ? devpmSystemPrefix() : undefined;
  const systemPrefix = [browsePrefix, devpmPrefix].filter(Boolean).join("\n\n") || undefined;

  const lastEventId = Number(req.headers.get("last-event-id") || "0");
  const existing = getSession(conversationId);

  // Reconnect: a Last-Event-ID and a live/recent session for this conversation.
  const isReconnect =
    lastEventId > 0 && existing != null &&
    (regenerate || isLastUserMessage(conversationId, message));

  if (isReconnect && existing) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(ctrl) {
        const writer = (chunk: string) => ctrl.enqueue(encoder.encode(chunk));
        addWriter(conversationId, writer, lastEventId);
        if (existing.finished) {
          // Everything missed has been replayed; close.
          ctrl.close();
        } else {
          req.signal.addEventListener("abort", () => {
            removeWriter(conversationId, writer);
            try { ctrl.close(); } catch {}
          });
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  // No replayable session — tell the client the response cannot be recovered.
  if (lastEventId > 0 && !existing) {
    const encoder = new TextEncoder();
    const body =
      `id: 1\nevent: reconnect-failed\ndata: ${JSON.stringify({
        message: "Your connection was interrupted and the response could not be recovered. Use the Regenerate button to retry.",
      })}\n\n`;
    return new Response(encoder.encode(body), { headers: SSE_HEADERS });
  }

  // New message — start a session and run the agent.
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const session = startSession(conversationId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      const writer = (chunk: string) => {
        try { ctrl.enqueue(encoder.encode(chunk)); } catch {}
      };
      session.writers.add(writer);
      try {
        for await (const ev of runAgent(conversationId, message || "", controller.signal, {
          regenerate: !!regenerate,
          systemPrefix,
          images: attachments,
        })) {
          pushEvent(conversationId, ev.type, ev);
        }
      } catch {
        pushEvent(conversationId, "error", { type: "error", message: "Stream failed unexpectedly.", code: "stream_error" });
      } finally {
        finishSession(conversationId);
        try { ctrl.close(); } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function isLastUserMessage(conversationId: string, message: unknown): boolean {
  if (typeof message !== "string") return false;
  const msgs = getMessages(conversationId);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return msgs[i].content === message;
  }
  return false;
}
