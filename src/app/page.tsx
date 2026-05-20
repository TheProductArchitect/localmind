"use client";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Input, Textarea, EmptyState } from "@/components/ui";
import { ToolCallCard, type ToolCallState } from "@/components/chat/tool-call-card";
import { ConfirmationCard, type ConfirmationState } from "@/components/chat/confirmation-card";
import { MicButton, SpeakerButton, speak } from "@/components/chat/voice";
import { toast } from "@/components/toast";
import { Plus, Send, Trash2, Star, Download, RefreshCw, Copy, Volume2 } from "lucide-react";

type Conversation = { id: string; title: string; updated_at: number; starred: number };
type ThreadItem =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "tool"; tc: ToolCallState }
  | { kind: "confirmation"; c: ConfirmationState };

function ChatInner() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [persona, setPersona] = useState("general");
  const threadRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const r = await fetch("/api/conversations");
    const j = await r.json();
    setConversations(j.conversations || []);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        if (j.settings && !j.settings.onboarded) window.location.href = "/onboarding";
        else setModel(j.settings?.active_model || null);
      });
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (searchParams.get("new") === "1") newConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread]);

  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    const r = await fetch(`/api/conversations/${id}`);
    const j = await r.json();
    const items: ThreadItem[] = [];
    for (const m of j.messages || []) {
      if (m.role === "user") items.push({ kind: "user", content: m.content });
      else if (m.role === "assistant") items.push({ kind: "assistant", content: m.content });
      else if (m.role === "tool") {
        try {
          const p = JSON.parse(m.content);
          items.push({
            kind: "tool",
            tc: { id: p.id, toolName: p.name, status: p.status, input: p.input, result: { status: p.status, output: p.output } },
          });
        } catch {}
      }
    }
    setThread(items);
  }

  async function newConversation() {
    const r = await fetch("/api/conversations", { method: "POST" });
    const j = await r.json();
    await loadConversations();
    setActiveId(j.conversation.id);
    setThread([]);
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleted: true }),
    });
    if (activeId === id) { setActiveId(null); setThread([]); }
    toast("Conversation moved to trash — recoverable for 7 days.");
    loadConversations();
  }

  async function toggleStar(id: string, starred: number) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred: starred ? 0 : 1 }),
    });
    loadConversations();
  }

  async function decide(toolCallId: string, decision: "allow" | "deny", pin?: string) {
    setThread((t) => t.filter((i) => !(i.kind === "confirmation" && i.c.toolCallId === toolCallId)));
    const r = await fetch("/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolCallId, decision, pin }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Confirmation failed", "error");
    }
  }

  async function streamChat(convId: string, body: any) {
    setStreaming(true);
    setError(null);
    let lastEventId = 0;
    let gotDone = false;
    let attempt = 0;

    const runOnce = async (): Promise<void> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversationId: convId, ...body }),
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
          const lines = chunk.split("\n");
          const idLine = lines.find((l) => l.startsWith("id: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          const eventLine = lines.find((l) => l.startsWith("event: "));
          if (idLine) lastEventId = Number(idLine.slice(4)) || lastEventId;
          if (eventLine?.slice(7) === "reconnect-failed") {
            setError("Your connection was interrupted. The response may be incomplete — use Regenerate.");
            gotDone = true;
            continue;
          }
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "done") gotDone = true;
          handleEvent(ev);
        }
      }
    };

    try {
      while (attempt < 4) {
        attempt++;
        try {
          await runOnce();
          if (gotDone) break;
          // Stream ended without `done` — reconnect and replay.
          if (attempt >= 4) {
            setError("Your connection was interrupted. The response may be incomplete — use Regenerate.");
            break;
          }
          setError("Reconnecting…");
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          if (attempt >= 4) {
            setError("Connection lost. Make sure LocalMind and Ollama are running.");
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (gotDone) setError(null);
    } finally {
      setStreaming(false);
      loadConversations();
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    let convId = activeId;
    if (!convId) {
      const r = await fetch("/api/conversations", { method: "POST" });
      convId = (await r.json()).conversation.id;
      setActiveId(convId);
    }
    setInput("");
    setThread((t) => [...t, { kind: "user", content: text }, { kind: "assistant", content: "" }]);
    streamChat(convId!, { message: text, persona });
  }

  async function regenerate() {
    if (!activeId || streaming) return;
    setThread((t) => {
      // remove trailing assistant/tool/confirmation items after last user
      let lastUser = -1;
      for (let i = t.length - 1; i >= 0; i--) if (t[i].kind === "user") { lastUser = i; break; }
      const kept = lastUser >= 0 ? t.slice(0, lastUser + 1) : t;
      return [...kept, { kind: "assistant", content: "" }];
    });
    streamChat(activeId, { regenerate: true, persona });
  }

  function handleEvent(ev: any) {
    setThread((t) => {
      const next = [...t];
      const lastAssistant = () => {
        for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === "assistant") return i;
        return -1;
      };
      if (ev.type === "text_chunk") {
        const idx = lastAssistant();
        if (idx >= 0) next[idx] = { kind: "assistant", content: (next[idx] as any).content + ev.delta };
      } else if (ev.type === "tool_call_start") {
        next.push({ kind: "tool", tc: { id: ev.toolCallId, toolName: ev.toolName, status: ev.status, input: ev.input } });
        next.push({ kind: "assistant", content: "" });
      } else if (ev.type === "tool_call_result") {
        for (let i = next.length - 1; i >= 0; i--) {
          const it = next[i];
          if (it.kind === "tool" && it.tc.id === ev.toolCallId) {
            next[i] = { kind: "tool", tc: { ...it.tc, result: { status: ev.status, output: ev.output } } };
            break;
          }
        }
      } else if (ev.type === "confirmation_required") {
        next.push({
          kind: "confirmation",
          c: { toolCallId: ev.toolCallId, actionType: ev.actionType, preview: ev.preview, timeoutSeconds: ev.timeoutSeconds, requiresPin: ev.requiresPin },
        });
      } else if (ev.type === "confirmation_timeout") {
        return next.filter((i) => !(i.kind === "confirmation" && i.c.toolCallId === ev.toolCallId));
      } else if (ev.type === "done") {
        if (autoRead) {
          const idx = lastAssistant();
          if (idx >= 0) speak((next[idx] as any).content);
        }
      } else if (ev.type === "error") {
        setError(ev.message);
      }
      return next;
    });
  }

  const visible = conversations.filter((c) =>
    !search || c.title.toLowerCase().includes(search.toLowerCase())
  );
  const lastAssistantHasContent =
    thread.length > 0 && thread[thread.length - 1].kind === "assistant" &&
    (thread[thread.length - 1] as any).content;

  return (
    <div className="flex h-full">
      <div className="w-60 shrink-0 border-r flex flex-col bg-muted/20">
        <div className="p-2 space-y-2">
          <Button className="w-full" onClick={newConversation}>
            <Plus className="h-4 w-4" /> New conversation
          </Button>
          <Input placeholder="Search conversations…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="h-8" />
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {visible.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">No conversations.</p>
          )}
          {visible.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-md px-2 py-1.5 text-sm cursor-pointer ${
                activeId === c.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => openConversation(c.id)}
            >
              <button onClick={(e) => { e.stopPropagation(); toggleStar(c.id, c.starred); }}>
                <Star className={`h-3.5 w-3.5 mr-1 ${c.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
              </button>
              <span className="truncate flex-1">{c.title}</span>
              <button className="opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="border-b px-4 py-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Model:</span>
          <span className="font-medium">{model || "none selected"}</span>
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            aria-label="Select assistant persona"
            className="ml-2 h-7 rounded border bg-background px-2 text-xs"
          >
            <option value="general">General assistant</option>
            <option value="devpm">DevPM</option>
          </select>
          <button
            onClick={() => setAutoRead((a) => !a)}
            className={`ml-2 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${autoRead ? "bg-accent" : "text-muted-foreground"}`}
          >
            <Volume2 className="h-3 w-3" /> Auto-read {autoRead ? "on" : "off"}
          </button>
          {activeId && (
            <a className="ml-auto" href={`/api/conversations/${activeId}/export`}>
              <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /> Export</Button>
            </a>
          )}
        </div>

        <div ref={threadRef} className="flex-1 overflow-y-auto p-6">
          {thread.length === 0 && (
            <EmptyState
              title="Start a conversation"
              hint="Ask anything, or try: “What files are in my approved folders?” or “Search the web for the latest on Apple Silicon.”"
            />
          )}
          <div className="max-w-3xl mx-auto">
            {thread.map((item, i) => {
              if (item.kind === "user")
                return (
                  <div key={i} className="my-3 flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
                      {item.content}
                    </div>
                  </div>
                );
              if (item.kind === "assistant")
                return item.content ? (
                  <div key={i} className="group my-3">
                    <div className="markdown text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 mt-1">
                      <button
                        className="text-xs text-muted-foreground flex items-center gap-1"
                        onClick={() => { navigator.clipboard.writeText(item.content); toast("Copied"); }}
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                      <SpeakerButton text={item.content} />
                    </div>
                  </div>
                ) : null;
              if (item.kind === "tool") return <ToolCallCard key={i} tc={item.tc} />;
              if (item.kind === "confirmation")
                return <ConfirmationCard key={i} c={item.c} onDecide={(d, p) => decide(item.c.toolCallId, d, p)} />;
              return null;
            })}
            {!streaming && lastAssistantHasContent && (
              <button
                onClick={regenerate}
                className="text-xs text-muted-foreground flex items-center gap-1 mt-2"
              >
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            )}
            {error && (
              <div className="my-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="border-t p-3">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Textarea
              rows={1}
              placeholder="Message LocalMind…  (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              className="resize-none"
            />
            <MicButton onText={(t) => setInput(t)} />
            <Button onClick={send} disabled={streaming || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <ChatInner />
    </Suspense>
  );
}
