import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent/engine";
import { devpmSystemPrefix } from "@/lib/devpm";
import { startSession, getSession, addWriter, removeWriter, pushEvent, finishSession } from "@/lib/agent/sse-hub";
import { getMessages } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disable proxy buffering so the first status/token reaches the UI immediately.
  "X-Accel-Buffering": "no",
};

export async function POST(req: NextRequest) {
  const { conversationId, message, regenerate, persona, browseSessionId, images } = await req.json();
  if (!conversationId || (!regenerate && typeof message !== "string")) {
    return new Response("conversationId and message are required", { status: 400 });
  }

  // Attachments: images (vision) and documents (text-extracted). Capped so a
  // stray upload can't blow up the request or the DB.
  const rawAttachments = Array.isArray(images)
    ? images
        .filter((a: any) => a && typeof a.data === "string" && typeof a.mime === "string")
        .slice(0, 6)
        .map((a: any) => ({
          name: typeof a.name === "string" ? a.name.slice(0, 200) : "file",
          mime: a.mime,
          data: a.data,
        }))
    : [];

  const imageAttachments = rawAttachments.filter((a) => a.mime.startsWith("image/"));
  const docAttachments = rawAttachments.filter(
    (a) =>
      !a.mime.startsWith("image/") &&
      (a.mime === "application/pdf" ||
        a.mime.includes("wordprocessingml") ||
        a.mime === "text/plain" ||
        a.mime === "text/markdown" ||
        /\.(pdf|docx|txt|md)$/i.test(a.name || ""))
  );

  let messageText = typeof message === "string" ? message : "";
  if (docAttachments.length) {
    try {
      const { extractDocumentText } = await import("@/lib/knowledge/parsers");
      const parts: string[] = [];
      for (const doc of docAttachments) {
        const text = await extractDocumentText(doc.name || "doc.pdf", doc.data, true);
        const clipped = text.slice(0, 80_000);
        parts.push(`--- Attached: ${doc.name} ---\n${clipped}${text.length > 80_000 ? "\n…[truncated]" : ""}`);
      }
      if (parts.length) {
        messageText = (messageText ? messageText + "\n\n" : "") + parts.join("\n\n");
      }
    } catch (e: any) {
      messageText =
        (messageText ? messageText + "\n\n" : "") +
        `[Could not extract text from attached document(s): ${e?.message || "parse error"}]`;
    }
  }

  const attachments = imageAttachments.length
    ? imageAttachments.map((a) => ({ name: a.name, mime: a.mime, data: a.data }))
    : undefined;

  const browseId =
    typeof browseSessionId === "string" && browseSessionId.trim() ? browseSessionId.trim() : null;
  // Link/unlink sync — cheap. Heavy Playwright snapshot moves into the stream
  // so we can return SSE headers immediately.
  if (browseId) {
    const { linkBrowseSession } = await import("@/lib/browse/session");
    linkBrowseSession(conversationId, browseId);
  } else {
    const { unlinkBrowseSession } = await import("@/lib/browse/session");
    unlinkBrowseSession(conversationId);
  }
  const devpmPrefix = persona === "devpm" ? devpmSystemPrefix() : undefined;

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

  // New message — start a session and run the agent. Return the Response
  // immediately so the client sees SSE within milliseconds.
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
        // Flush padding so proxies / Electron don't buffer the first real event.
        try {
          ctrl.enqueue(encoder.encode(`: connected\n\n`));
        } catch { /* ignore */ }
        // First byte ASAP — UI shows "Preparing…" before any model work.
        pushEvent(conversationId, "status", { type: "status", phase: "preparing" });

        let browsePrefix: string | undefined;
        if (browseId) {
          pushEvent(conversationId, "status", {
            type: "status",
            phase: "preparing",
            detail: "Reading browse tab…",
          });
          try {
            const { buildBrowseContextPrefix } = await import("@/lib/browse/session");
            browsePrefix = await buildBrowseContextPrefix(browseId);
          } catch {
            /* browse context is best-effort */
          }
        }
        const systemPrefix = [browsePrefix, devpmPrefix].filter(Boolean).join("\n\n") || undefined;

        for await (const ev of runAgent(conversationId, messageText || "", controller.signal, {
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
