"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Textarea } from "@/components/ui";
import { Send, Loader2, PanelRightClose } from "lucide-react";

const SESSION_KEY = "lm-browse-session-id";

type Props = {
  browseSessionId: string | null;
  onBrowseAction?: () => void;
  /** When provided, a "hide" control appears in the header. */
  onHide?: () => void;
};

type Msg = { role: "user" | "assistant"; content: string };

export function BrowseSoraPanel({ browseSessionId, onBrowseAction, onHide }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/conversations", { method: "POST" })
      .then((r) => r.json())
      .then((j) => setConversationId(j.conversation?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const send = useCallback(async () => {
    const text = input.trim();
    // browseSessionId is optional: without it the panel is plain chat
    // (questions while browsing); with it Sora can also see/act on the page.
    if (!text || !conversationId || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setStreaming(true);
    let assistant = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: text,
          ...(browseSessionId ? { browseSessionId } : {}),
        }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "text_chunk") {
            assistant += ev.delta;
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", content: assistant };
              else copy.push({ role: "assistant", content: assistant });
              return copy;
            });
          }
          if (ev.type === "tool_call_start" && ev.toolName === "browse_session") onBrowseAction?.();
          if (ev.type === "tool_text_recovered") {
            // Drop a leaked raw-JSON tool call the engine recovered into a real call.
            assistant = "";
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", content: "" };
              return copy;
            });
          }
        }
      }
      if (!assistant) setMessages((m) => [...m, { role: "assistant", content: "(No response)" }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Could not reach Sora." }]);
    } finally {
      setStreaming(false);
      onBrowseAction?.();
    }
  }, [input, conversationId, streaming, browseSessionId, onBrowseAction]);

  return (
    <div className="flex flex-col h-full min-h-[280px] border-t lg:border-t-0 lg:border-l border-white/10 bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/10 shrink-0 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="lm-micro mb-0.5">Sora</p>
          <p className="text-xs text-muted-foreground">Ask about this page or tell me what to click and type.</p>
        </div>
        {onHide && (
          <button
            onClick={onHide}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
            title="Hide Sora (⌘/)"
            aria-label="Hide Sora panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" /> Hide
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {!browseSessionId && messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask me anything while you browse. Grant me access to a tab (the eye toggle) and I can also see and act on the page.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === "user" ? (
              <p className="text-sm bg-white/10 rounded-xl px-3 py-2 ml-8">{m.content}</p>
            ) : (
              <article className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </article>
            )}
          </div>
        ))}
        {streaming && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-white/10 flex gap-2 shrink-0">
        <Textarea
          rows={2}
          placeholder="Ask Sora…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={!conversationId || streaming}
          className="resize-none min-h-[2.5rem]"
        />
        <Button size="icon" onClick={send} disabled={!input.trim() || streaming}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export { SESSION_KEY };
