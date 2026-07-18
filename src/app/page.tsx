"use client";

/**
 * Chat — the gravitational center of LocalMind v2.
 *
 * Layout, in order from left to right:
 *
 *   [ Rail (in layout) ]  [ Conversations strip ]  [ Thread column ]  [ Sora rail ]
 *
 * Conversations strip is a quiet glass panel — no titles or chrome, just
 * starred-or-recent chat names. The thread column is a centered 720px-max
 * stream with hairline separation between turns. The Sora rail on the right
 * carries the live <Orb/> whose state mirrors the streaming events:
 *
 *   idle      — not streaming
 *   thinking  — streaming, no tool in flight
 *   tool      — a tool call is running
 *   spawn     — a `spawn_subagent*` tool is running (N satellites = subagent count)
 *   suspended — loop guard has paused the conversation
 *   error     — last event was an error (briefly)
 *
 * All streaming logic is preserved verbatim from the previous shell; only the
 * presentation and the orb wiring are new.
 */

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Textarea } from "@/components/ui";
import { ToolCallCard, type ToolCallState } from "@/components/chat/tool-call-card";
import { ConfirmationCard, type ConfirmationState } from "@/components/chat/confirmation-card";
import { MicButton, SpeakerButton, ConversationButton, speak } from "@/components/chat/voice";
import { toast } from "@/components/toast";
import { Orb, type OrbState } from "@/components/orb";
import { Plus, Send, Trash2, Star, Copy, RefreshCw, Volume2, Download, Paperclip, X } from "lucide-react";

type Conversation = { id: string; title: string; updated_at: number; starred: number };
type Attachment = { name: string; mime: string; data: string; url: string };
type ThreadItem =
  | { kind: "user"; content: string; images?: string[] }
  | { kind: "assistant"; content: string }
  | { kind: "tool"; tc: ToolCallState }
  | { kind: "confirmation"; c: ConfirmationState };

const MAX_ATTACH = 6;
const MAX_IMG_DIM = 1024;

// Read an image file, downscale it (bounds base64 size + context tokens), and
// return a base64 attachment for a multimodal turn.
async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  try {
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    let { width, height } = img;
    if (width > MAX_IMG_DIM || height > MAX_IMG_DIM) {
      const s = Math.min(MAX_IMG_DIM / width, MAX_IMG_DIM / height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { name: file.name, mime: file.type, data: dataUrl.replace(/^data:[^;]+;base64,/, ""), url: dataUrl };
    ctx.drawImage(img, 0, 0, width, height);
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const out = canvas.toDataURL(mime, 0.85);
    return { name: file.name, mime, data: out.replace(/^data:[^;]+;base64,/, ""), url: out };
  } catch {
    return { name: file.name, mime: file.type, data: dataUrl.replace(/^data:[^;]+;base64,/, ""), url: dataUrl };
  }
}

function attachmentsToImageUrls(attachmentsJson: string | null | undefined): string[] | undefined {
  if (!attachmentsJson) return undefined;
  try {
    const arr = JSON.parse(attachmentsJson) as { mime?: string; data?: string }[];
    const urls = arr
      .map((a) => (a?.data ? (a.data.startsWith("data:") ? a.data : `data:${a.mime || "image/jpeg"};base64,${a.data}`) : ""))
      .filter(Boolean);
    return urls.length ? urls : undefined;
  } catch {
    return undefined;
  }
}

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
  // Sora is now the only "lead" persona for chat. Sub-agents (Writer, Coder,
  // Researcher, etc.) are summoned by Sora via spawn_subagent. The legacy
  // `persona` value is preserved so the backend keeps routing to the right
  // assembled prompt, but the UI no longer exposes a selector.
  const [persona] = useState("general");
  const [agentMode, setAgentMode] = useState<"auto" | "plan" | "ask">("ask");

  // Fleet chat relay — when a peer is selected, send() routes through
  // /api/fleet/peers/[id]/chat instead of the local streaming /api/chat.
  // The selector defaults to null = "this machine".
  type FleetPeer = {
    peer_node_id: string;
    label: string | null;
    primary_addr: string | null;
    paired_at: number;
    last_seen_at: number | null;
    trusted: number;
  };
  const [peers, setPeers] = useState<FleetPeer[]>([]);
  const [runOnPeer, setRunOnPeer] = useState<string | null>(null);

  // Conversation-mode handshake with <ConversationButton/>. When streaming
  // ends and `conversationActive` is on, we hand the latest assistant reply
  // over via `assistantToSpeak`; the button reads it and clears it back via
  // `clearAssistantToSpeak`, then the loop resumes.
  const [conversationActive, setConversationActive] = useState(false);
  const [assistantToSpeak, setAssistantToSpeak] = useState<string | null>(null);
  const lastSpokenRef = useRef<string | null>(null);

  // v2 — orb live state. activeTools tracks tool calls still in flight so we
  // can swing between "thinking" (none) and "tool"/"spawn" (one or more).
  const [activeTools, setActiveTools] = useState<Record<string, string>>({});
  const [orbErrorUntil, setOrbErrorUntil] = useState(0);
  const [suspendedNotice, setSuspendedNotice] = useState<{ reason: string; tool: string } | null>(null);

  // Multimodal input — staged image attachments for the next turn.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.some((f) => f.type.startsWith("video/"))) {
      toast("Video isn't supported by local vision models yet — images only for now.", "info");
    }
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    const added: Attachment[] = [];
    for (const f of imgs) {
      const a = await fileToAttachment(f);
      if (a) added.push(a);
    }
    if (added.length) setAttachments((cur) => [...cur, ...added].slice(0, MAX_ATTACH));
    e.target.value = "";
  }

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
        else {
          setModel(j.settings?.active_model || null);
          setAgentMode((j.settings?.agent_mode as "auto" | "plan" | "ask") || "ask");
          const fs = Number(j.settings?.chat_font_size);
          if (fs >= 12 && fs <= 28) {
            document.documentElement.style.setProperty("--lm-root-fs", `${fs}px`);
          }
        }
      });
    loadConversations();
    // Best-effort peer fetch for the "Run on" composer selector. Failure is
    // silent — if the user isn't an owner the endpoint 403s and we just hide
    // the dropdown.
    fetch("/api/fleet/peers")
      .then((r) => (r.ok ? r.json() : { peers: [] }))
      .then((j) => setPeers((j.peers as FleetPeer[]) || []))
      .catch(() => setPeers([]));
  }, [loadConversations]);

  async function changeMode(next: "auto" | "plan" | "ask") {
    setAgentMode(next);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_mode: next }),
    });
    toast(`Mode → ${next}`, "success");
  }

  useEffect(() => {
    if (searchParams.get("new") === "1") newConversation();
    // Prefill from other surfaces (e.g. Browse → "Ask Sora about this page").
    const ask = searchParams.get("ask");
    if (ask) setInput(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread]);

  // Auto-fade error state on the orb 1.5s after it fires.
  useEffect(() => {
    if (!orbErrorUntil) return;
    const ms = orbErrorUntil - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => setOrbErrorUntil(0), ms);
    return () => clearTimeout(t);
  }, [orbErrorUntil]);

  // === Conversation CRUD ===
  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    setSuspendedNotice(null);
    const r = await fetch(`/api/conversations/${id}`);
    const j = await r.json();
    const items: ThreadItem[] = [];
    for (const m of j.messages || []) {
      if (m.role === "user") items.push({ kind: "user", content: m.content, images: attachmentsToImageUrls(m.attachments) });
      else if (m.role === "assistant") items.push({ kind: "assistant", content: m.content });
      else if (m.role === "tool") {
        try {
          const p = JSON.parse(m.content);
          items.push({ kind: "tool", tc: { id: p.id, toolName: p.name, status: p.status, input: p.input, result: { status: p.status, output: p.output } } });
        } catch {}
      }
    }
    setThread(items);

    // Check if this conversation is currently suspended.
    fetch(`/api/chat/resume?conversation_id=${id}`)
      .then((r) => r.json()).catch(() => null)
      .then((j) => {
        if (j?.suspended) setSuspendedNotice({ reason: j.reason ?? "Suspended", tool: j.tool ?? "" });
      });
  }

  async function newConversation() {
    const r = await fetch("/api/conversations", { method: "POST" });
    const j = await r.json();
    await loadConversations();
    setActiveId(j.conversation.id);
    setThread([]);
    setSuspendedNotice(null);
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

  async function resumeSuspended() {
    if (!activeId) return;
    const r = await fetch("/api/chat/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: activeId }),
    });
    if (r.ok) {
      setSuspendedNotice(null);
      toast("Conversation resumed.");
    } else {
      toast("Could not resume — check the audit log.", "error");
    }
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

  // === Streaming ===
  async function streamChat(convId: string, body: any) {
    setStreaming(true);
    setError(null);
    setActiveTools({});
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
          // Terminal events: stop reconnecting so we don't overwrite a real
          // agent error with "connection was interrupted".
          if (ev.type === "done" || ev.type === "error") gotDone = true;
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
          if (attempt >= 4) { setError("Your connection was interrupted. Use Regenerate to retry."); break; }
          setError("Reconnecting…");
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          if (attempt >= 4) { setError("Connection lost. Make sure LocalMind and Ollama are running."); break; }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (gotDone) setError(null);
    } finally {
      setStreaming(false);
      setActiveTools({});
      loadConversations();
      // Conversation-mode handoff: once streaming has stopped, hand the
      // latest assistant turn over to <ConversationButton/> for TTS. We
      // read from a ref-style closure of the latest thread state.
      if (conversationActive) {
        setThread((current) => {
          for (let i = current.length - 1; i >= 0; i--) {
            const it = current[i];
            if (it.kind === "assistant" && it.content && it.content !== lastSpokenRef.current) {
              lastSpokenRef.current = it.content;
              setAssistantToSpeak(it.content);
              break;
            }
          }
          return current;
        });
      }
    }
  }

  // ConversationButton delivers a complete utterance here. We seed the
  // composer with it for visibility (so the user sees what we heard), then
  // immediately send. The button itself manages turn-taking state.
  async function sendUtterance(text: string) {
    const cleaned = text.trim();
    if (!cleaned || streaming) return;
    setInput("");
    let convId = activeId;
    if (!convId) {
      const r = await fetch("/api/conversations", { method: "POST" });
      convId = (await r.json()).conversation.id;
      setActiveId(convId);
    }
    setThread((t) => [...t, { kind: "user", content: cleaned }, { kind: "assistant", content: "" }]);
    streamChat(convId!, { message: cleaned, persona });
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    let convId = activeId;
    if (!convId) {
      const r = await fetch("/api/conversations", { method: "POST" });
      convId = (await r.json()).conversation.id;
      setActiveId(convId);
    }
    const outgoing = attachments;
    const images = outgoing.map((a) => ({ name: a.name, mime: a.mime, data: a.data }));
    setInput("");
    setAttachments([]);
    setThread((t) => [
      ...t,
      { kind: "user", content: text, images: outgoing.length ? outgoing.map((a) => a.url) : undefined },
      { kind: "assistant", content: "" },
    ]);

    // Fleet chat relay: when the user selects a peer, route the turn through
    // /api/fleet/peers/[id]/chat instead of the local streaming endpoint. The
    // relay is non-streaming for v1 (single response back); the executor's
    // local permission profile + destructive-action floor still apply.
    if (runOnPeer) {
      try {
        setStreaming(true);
        const res = await fetch(`/api/fleet/peers/${runOnPeer}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversation_id: convId, message: text, persona_id: persona }),
        });
        const j = await res.json();
        if (!res.ok) {
          setError(j.error ?? `Peer returned ${res.status}`);
          setThread((t) => {
            const out = [...t];
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].kind === "assistant") { out.splice(i, 1); break; }
            }
            return out;
          });
        } else {
          setThread((t) => {
            const out = [...t];
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].kind === "assistant") { out[i] = { kind: "assistant", content: j.reply }; break; }
            }
            return out;
          });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setStreaming(false);
        loadConversations();
      }
      return;
    }

    streamChat(convId!, { message: text, persona, ...(images.length ? { images } : {}) });
  }

  async function regenerate() {
    if (!activeId || streaming) return;
    setThread((t) => {
      let lastUser = -1;
      for (let i = t.length - 1; i >= 0; i--) if (t[i].kind === "user") { lastUser = i; break; }
      const kept = lastUser >= 0 ? t.slice(0, lastUser + 1) : t;
      return [...kept, { kind: "assistant", content: "" }];
    });
    streamChat(activeId, { regenerate: true, persona });
  }

  function handleEvent(ev: any) {
    if (ev.type === "tool_call_start") {
      setActiveTools((m) => ({ ...m, [ev.toolCallId]: ev.toolName }));
    } else if (ev.type === "tool_call_result") {
      setActiveTools((m) => { const n = { ...m }; delete n[ev.toolCallId]; return n; });
    } else if (ev.type === "loop_suspended") {
      setSuspendedNotice({ reason: ev.reason ?? "Loop detected.", tool: ev.tool ?? "" });
    } else if (ev.type === "error") {
      setError(ev.message);
      setOrbErrorUntil(Date.now() + 1500);
    }

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
            next[i] = {
              kind: "tool",
              tc: {
                ...it.tc,
                result: { status: ev.status, output: ev.output, summary: ev.summary },
              },
            };
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
      } else if (ev.type === "tool_text_recovered") {
        // The model emitted a tool call as raw JSON text; the engine recovered
        // it into a real call. Clear the leaked JSON from the current bubble.
        const idx = lastAssistant();
        if (idx >= 0) next[idx] = { kind: "assistant", content: "" };
      } else if (ev.type === "done") {
        if (autoRead) {
          const idx = lastAssistant();
          if (idx >= 0) speak((next[idx] as any).content);
        }
      }
      return next;
    });
  }

  // Derive the orb state from current activity.
  const orbState: OrbState = (() => {
    if (suspendedNotice) return "suspended";
    if (orbErrorUntil > Date.now()) return "error";
    const tools = Object.values(activeTools);
    if (tools.some((t) => t.startsWith("spawn_subagent"))) return "spawn";
    if (tools.length > 0) return "tool";
    if (streaming) return "thinking";
    return "idle";
  })();
  const spawnCount = Object.values(activeTools).filter((t) => t.startsWith("spawn_subagent")).length || 3;

  const visible = conversations.filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()));
  const lastAssistantHasContent =
    thread.length > 0 && thread[thread.length - 1].kind === "assistant" && (thread[thread.length - 1] as any).content;

  return (
    <div className="lm-chat">
      {/* Conversations strip */}
      <aside className="lm-conv">
        <button onClick={newConversation} className="lm-conv__new" data-pulse="true">
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="lm-conv__search"
        />
        <div className="lm-conv__list">
          {visible.length === 0 && (
            <p className="lm-body px-1" style={{ color: "hsl(0 0% 100% / 0.35)" }}>No conversations.</p>
          )}
          {visible.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`lm-conv__row ${activeId === c.id ? "is-active" : ""}`}
              data-pulse="true"
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleStar(c.id, c.starred); }}
                aria-label={c.starred ? "Unstar" : "Star"}
                className="lm-conv__star"
              >
                <Star className={`h-3.5 w-3.5 ${c.starred ? "fill-white" : ""}`} style={{ color: c.starred ? "white" : "hsl(0 0% 100% / 0.3)" }} />
              </button>
              <span className="lm-conv__title">{c.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                data-pulse-action="destructive"
                aria-label="Delete"
                className="lm-conv__del"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Thread column */}
      <section className="lm-thread">
        <header className="lm-thread__head">
          <div className="flex items-center gap-3">
            <span className="lm-micro">Model</span>
            <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.92)" }}>{model || "—"}</span>
            <span className="lm-thread__sep" />
            <span className="lm-micro">Lead</span>
            <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.92)" }}>Sora</span>
            <a href="/agents" className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.45)" }} data-pulse="true">
              · agents
            </a>
            <button
              onClick={() => setAutoRead((a) => !a)}
              className="lm-thread__toggle"
              data-active={autoRead}
            >
              <Volume2 className="h-3 w-3" />
              <span>Auto-read</span>
            </button>
            <ConversationButton
              isAssistantBusy={streaming}
              assistantSay={conversationActive ? assistantToSpeak : null}
              onActiveChange={(active) => {
                setConversationActive(active);
                if (!active) setAssistantToSpeak(null);
              }}
              onUtterance={sendUtterance}
              onAssistantSpoken={() => setAssistantToSpeak(null)}
            />
            <span className="lm-thread__sep" />
            <div className="lm-mode" role="group" aria-label="Agent mode">
              {(["auto", "plan", "ask"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => changeMode(m)}
                  className="lm-mode__seg"
                  data-active={agentMode === m}
                  data-pulse="true"
                  title={
                    m === "auto" ? "Auto — Sora may act without confirmation" :
                    m === "plan" ? "Plan — read-only; mutations require leaving plan" :
                    "Ask — confirms before mutations"
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {activeId && (
            <a href={`/api/conversations/${activeId}/export`} className="lm-thread__export" data-pulse="true">
              <Download className="h-3.5 w-3.5" />
              <span className="lm-micro">Export</span>
            </a>
          )}
        </header>

        {suspendedNotice && (
          <div className="lm-suspend" role="alert">
            <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.9)" }}>Suspended</span>
            <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.7)" }}>
              {suspendedNotice.reason}
            </span>
            <button onClick={resumeSuspended} className="lm-suspend__btn" data-pulse="true">
              <span className="lm-glow">Resume</span>
            </button>
          </div>
        )}

        <div ref={threadRef} className="lm-thread__scroll">
          <div className="mx-auto" style={{ maxWidth: 720 }}>
            {thread.length === 0 && (
              <div className="lm-empty">
                <Orb state="idle" size={120} />
                <p className="lm-display mt-10">Ask anything.</p>
                <p className="lm-body mt-2" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
                  Everything runs on this machine. Nothing leaves the box.
                </p>
              </div>
            )}
            {thread.map((item, i) => {
              if (item.kind === "user")
                return (
                  <div key={i} className="lm-turn lm-turn--user">
                    <div className="lm-bubble">
                      {item.images?.length ? (
                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                          {item.images.map((u, k) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={k} src={u} alt="attachment" className="h-28 w-28 object-cover rounded-lg border border-black/10" />
                          ))}
                        </div>
                      ) : null}
                      {item.content}
                    </div>
                  </div>
                );
              if (item.kind === "assistant")
                return item.content ? (
                  <div key={i} className="lm-turn lm-turn--assistant group">
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                    </div>
                    <div className="lm-turn__actions">
                      <button
                        onClick={() => { navigator.clipboard.writeText(item.content); toast("Copied"); }}
                        className="lm-turn__action"
                        data-pulse="true"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                      <SpeakerButton text={item.content} />
                    </div>
                  </div>
                ) : null;
              if (item.kind === "tool") return <div key={i} className="lm-turn"><ToolCallCard tc={item.tc} /></div>;
              if (item.kind === "confirmation")
                return <div key={i} className="lm-turn"><ConfirmationCard c={item.c} onDecide={(d, p) => decide(item.c.toolCallId, d, p)} /></div>;
              return null;
            })}
            {!streaming && lastAssistantHasContent && (
              <button onClick={regenerate} className="lm-regen" data-pulse="true">
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            )}
            {error && <div className="lm-error">{error}</div>}
          </div>
        </div>

        <footer className="lm-composer">
          {peers.length > 0 && (
            <div className="mx-auto flex items-center gap-2 mb-2" style={{ maxWidth: 720 }}>
              <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Run on</span>
              <select
                value={runOnPeer ?? ""}
                onChange={(e) => setRunOnPeer(e.target.value || null)}
                className="lm-peer-select"
                aria-label="Choose which machine runs this turn"
              >
                <option value="">This machine</option>
                {peers.map((p) => (
                  <option key={p.peer_node_id} value={p.peer_node_id}>
                    {p.label || p.peer_node_id.slice(0, 12)}
                  </option>
                ))}
              </select>
              {runOnPeer && (() => {
                const p = peers.find((x) => x.peer_node_id === runOnPeer);
                if (!p) return null;
                const fmt = (ms: number | null) =>
                  ms == null ? "never" : new Date(ms).toLocaleString();
                const tooltip = [
                  `node_id      ${p.peer_node_id}`,
                  `label        ${p.label ?? "(unset)"}`,
                  `address      ${p.primary_addr ?? "(unknown)"}`,
                  `trusted      ${p.trusted ? "yes" : "no"}`,
                  `paired       ${fmt(p.paired_at)}`,
                  `last seen    ${fmt(p.last_seen_at)}`,
                ].join("\n");
                return (
                  <>
                    <span
                      className="lm-micro"
                      style={{ color: "hsl(40 80% 70%)", textTransform: "none", letterSpacing: 0 }}
                      title="This turn runs on a paired peer over a signed envelope; the peer's local permission floor applies. Peer-relayed chats are part of a bilateral audit chain and cannot be deleted."
                    >
                      ↗ remote execution
                    </span>
                    <span
                      role="img"
                      aria-label={`Peer details: ${tooltip}`}
                      title={tooltip}
                      className="lm-peer-info"
                      tabIndex={0}
                    >
                      ⓘ
                    </span>
                  </>
                );
              })()}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mx-auto flex flex-wrap gap-2 mb-2" style={{ maxWidth: 720 }}>
              {attachments.map((a, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="h-16 w-16 object-cover rounded-lg border border-white/10" />
                  <button
                    onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    aria-label="Remove attachment"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-background border border-white/20 text-white/70 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto flex items-end gap-2" style={{ maxWidth: 720 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || attachments.length >= MAX_ATTACH}
              className="lm-composer__send"
              style={{ background: "hsl(0 0% 100% / 0.06)", color: "hsl(0 0% 100% / 0.9)" }}
              aria-label="Attach image"
              title="Attach image (vision models)"
              data-pulse="true"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <Textarea
              rows={1}
              placeholder={runOnPeer ? "Message Sora on the selected peer…" : "Message Sora…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="lm-composer__input"
              data-pulse="false"
            />
            <MicButton onText={(t) => setInput(t)} />
            <button
              onClick={send}
              disabled={streaming || (!input.trim() && attachments.length === 0)}
              className="lm-composer__send"
              aria-label="Send"
              data-pulse="true"
              data-pulse-action="send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </section>

      {/* Sora rail (right) */}
      <aside className="lm-sora">
        <div className="lm-sora__top">
          <Orb state={orbState} size={56} satellites={spawnCount} ariaLabel={`Sora ${orbState}`} />
          <p className="lm-micro mt-4 text-center">Sora</p>
          <p className="lm-body mt-1 text-center" style={{ color: "hsl(0 0% 100% / 0.5)", fontSize: 11 }}>
            {orbStateLabel(orbState)}
          </p>
        </div>
        {Object.entries(activeTools).length > 0 && (
          <div className="lm-sora__tools">
            <div className="flex items-center justify-between mb-2">
              <p className="lm-micro">In flight</p>
              <a href="/agents" className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.45)" }} data-pulse="true">
                See all →
              </a>
            </div>
            {Object.entries(activeTools).map(([id, name]) => {
              const isSpawn = name.startsWith("spawn_subagent");
              return (
                <div key={id} className="lm-sora__agent lm-agent-card--enter" data-spawn={isSpawn}>
                  <Orb state="thinking" size={20} />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 12, color: "hsl(0 0% 100% / 0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {name.replace(/^spawn_subagent(s_parallel)?$/, isSpawn && name.endsWith("parallel") ? "spawning batch…" : "spawning…")}
                    </p>
                    <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, fontSize: 10, color: "hsl(0 0% 100% / 0.4)" }}>
                      {isSpawn ? "subagent" : "tool"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <style jsx>{`
        .lm-chat {
          display: grid;
          grid-template-columns: 240px 1fr 220px;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        @media (max-width: 1100px) { .lm-chat { grid-template-columns: 200px 1fr 0; } .lm-sora { display: none; } }
        /* Tablet/phone: narrow the conversations strip so the thread keeps room.
           The left Rail becomes a bottom bar under md, freeing its width. */
        @media (max-width: 680px) { .lm-chat { grid-template-columns: 148px 1fr 0; } }
        @media (max-width: 680px) {
          .lm-thread__head { padding: 12px 14px; flex-wrap: wrap; gap: 8px; row-gap: 8px; }
          .lm-thread__scroll { padding: 24px 14px 48px; }
          .lm-composer { padding: 12px 14px 16px; }
        }

        /* === Conversations strip === */
        .lm-conv {
          display: flex; flex-direction: column;
          border-right: 1px solid hsl(0 0% 100% / 0.06);
          background: hsl(234 22% 4% / 0.4);
          backdrop-filter: blur(14px);
          padding: 16px 10px;
          gap: 8px;
          min-height: 0;
          overflow: hidden;
        }
        .lm-conv__new {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; padding: 8px 10px;
          background: hsl(0 0% 100% / 0.04);
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: 12px;
          color: hsl(0 0% 100% / 0.9);
          font-size: 12px; letter-spacing: -0.005em;
          transition: background var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-conv__new:hover { background: hsl(0 0% 100% / 0.08); }
        .lm-conv__search {
          background: transparent;
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: 10px;
          padding: 6px 10px;
          color: hsl(0 0% 100% / 0.9);
          font-size: 12px;
          outline: none;
        }
        .lm-conv__search:focus { border-color: hsl(0 0% 100% / 0.2); }
        .lm-conv__list { flex: 1; overflow-y: auto; }
        .lm-conv__row {
          display: grid;
          grid-template-columns: 16px 1fr 16px;
          align-items: center;
          gap: 8px;
          padding: 7px 6px;
          border-radius: 8px;
          cursor: pointer;
          color: hsl(0 0% 100% / 0.72);
          font-size: 12.5px;
        }
        .lm-conv__row:hover { background: hsl(0 0% 100% / 0.04); }
        .lm-conv__row.is-active { background: hsl(0 0% 100% / 0.06); color: hsl(0 0% 100% / 0.96); }
        .lm-conv__star { display: inline-flex; }
        .lm-conv__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lm-conv__del { opacity: 0; color: hsl(0 0% 100% / 0.4); }
        .lm-conv__row:hover .lm-conv__del { opacity: 1; }

        /* === Thread === */
        .lm-thread {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          height: 100%;
          overflow: hidden;
        }
        .lm-thread__head {
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
          padding: 14px 28px;
          border-bottom: 1px solid hsl(0 0% 100% / 0.06);
          background: hsl(234 22% 4% / 0.72);
          backdrop-filter: blur(12px);
          z-index: 2;
        }
        .lm-thread__sep { width: 1px; height: 14px; background: hsl(0 0% 100% / 0.10); margin: 0 4px; }
        .lm-thread__select, .lm-thread__toggle, .lm-thread__export {
          font-size: 11.5px; letter-spacing: -0.005em;
          color: hsl(0 0% 100% / 0.7);
          background: transparent;
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: 8px; padding: 4px 10px;
          display: inline-flex; align-items: center; gap: 6px;
          transition: background var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-thread__toggle[data-active="true"] {
          background: hsl(0 0% 100% / 0.06); color: hsl(0 0% 100% / 0.96);
        }
        .lm-thread__select:hover, .lm-thread__toggle:hover, .lm-thread__export:hover {
          background: hsl(0 0% 100% / 0.06);
        }
        .lm-thread__select option { background: hsl(234 18% 8%); }

        /* Agent mode — segmented control. Auto state gets a soft glow so the
           user is always aware Sora is operating with full autonomy. */
        .lm-mode {
          display: inline-flex; align-items: center;
          padding: 2px;
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: 9999px;
          background: hsl(0 0% 100% / 0.03);
        }
        .lm-mode__seg {
          padding: 3px 10px;
          font-size: 11px; letter-spacing: 0.02em;
          text-transform: uppercase;
          color: hsl(0 0% 100% / 0.5);
          border-radius: 9999px;
          background: transparent;
          border: none;
          transition: background var(--lm-dur-micro) var(--lm-ease-micro),
                      color      var(--lm-dur-micro) var(--lm-ease-micro),
                      box-shadow var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-mode__seg:hover { color: hsl(0 0% 100% / 0.9); }
        .lm-mode__seg[data-active="true"] {
          background: hsl(0 0% 100% / 0.10);
          color: hsl(0 0% 100%);
        }
        /* Auto-on flag — soft glow nudges the eye that Sora is unsupervised. */
        .lm-mode__seg[data-active="true"]:first-child {
          box-shadow: 0 0 14px hsl(0 0% 100% / 0.35);
        }

        .lm-thread__scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 40px 28px 60px;
        }

        .lm-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 60px 0;
        }

        .lm-turn { padding: 14px 0; }
        .lm-turn--user { display: flex; justify-content: flex-end; }
        .lm-turn--user .lm-bubble {
          max-width: 80%;
          padding: 10px 14px;
          border-radius: 14px 14px 4px 14px;
          background: hsl(0 0% 100% / 0.94);
          color: hsl(234 22% 4%);
          font-size: 1rem;
          line-height: 1.55;
          letter-spacing: -0.005em;
          white-space: pre-wrap;
        }
        .lm-turn--assistant {
          padding-right: 24px;
          font-size: 1rem;
          line-height: 1.55;
        }
        .lm-turn--assistant :global(.markdown) {
          font-size: inherit;
          line-height: inherit;
        }
        .lm-turn__actions {
          display: flex; align-items: center; gap: 10px;
          margin-top: 8px;
          opacity: 0;
          transition: opacity var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-turn--assistant:hover .lm-turn__actions { opacity: 1; }
        .lm-turn__action {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11px; color: hsl(0 0% 100% / 0.4);
        }
        .lm-turn__action:hover { color: hsl(0 0% 100% / 0.8); }

        .lm-peer-select {
          background: hsl(0 0% 100% / 0.04);
          border: 1px solid hsl(0 0% 100% / 0.12);
          color: hsl(0 0% 100% / 0.85);
          border-radius: 6px;
          padding: 2px 8px;
          font-size: 11px;
          font-family: ui-monospace, monospace;
        }
        .lm-peer-select:focus { outline: 1px solid hsl(0 0% 100% / 0.3); }
        .lm-peer-info {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          font-size: 11px;
          line-height: 1;
          color: hsl(0 0% 100% / 0.5);
          border: 1px solid hsl(0 0% 100% / 0.18);
          border-radius: 50%;
          cursor: help;
          background: hsl(0 0% 100% / 0.04);
        }
        .lm-peer-info:hover, .lm-peer-info:focus {
          color: hsl(0 0% 100% / 0.9);
          border-color: hsl(0 0% 100% / 0.35);
          outline: none;
        }

        .lm-regen {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; color: hsl(0 0% 100% / 0.5);
          margin-top: 8px;
        }
        .lm-regen:hover { color: hsl(0 0% 100% / 0.9); }

        .lm-error {
          margin: 12px 0;
          padding: 10px 14px;
          border: 1px solid hsl(0 100% 70% / 0.3);
          border-radius: 10px;
          background: hsl(0 100% 50% / 0.05);
          color: hsl(0 100% 82%);
          font-size: 13px;
        }

        /* === Suspended banner === */
        .lm-suspend {
          display: flex; align-items: center; gap: 14px;
          margin: 16px 28px 0;
          padding: 10px 14px;
          border: 1px solid hsl(0 0% 100% / 0.18);
          border-radius: 10px;
          background: hsl(0 0% 100% / 0.03);
        }
        .lm-suspend__btn {
          margin-left: auto;
          padding: 4px 12px;
          border-radius: 8px;
          background: hsl(0 0% 100% / 0.08);
          border: 1px solid hsl(0 0% 100% / 0.16);
          font-size: 12px;
          color: hsl(0 0% 100% / 0.96);
        }
        .lm-suspend__btn:hover { background: hsl(0 0% 100% / 0.14); }

        /* === Composer === */
        .lm-composer {
          flex-shrink: 0;
          padding: 18px 28px 22px;
          border-top: 1px solid hsl(0 0% 100% / 0.06);
          background: hsl(234 22% 4% / 0.72);
          backdrop-filter: blur(12px);
        }
        .lm-composer :global(.lm-composer__input) {
          flex: 1;
          background: hsl(0 0% 100% / 0.04);
          border: 1px solid hsl(0 0% 100% / 0.10);
          border-radius: 14px;
          padding: 12px 14px;
          color: hsl(0 0% 100% / 0.96);
          font-size: 1rem;
          line-height: 1.45;
          resize: none;
          outline: none;
          min-height: 46px;
          max-height: 200px;
        }
        .lm-composer :global(.lm-composer__input:focus) {
          border-color: hsl(0 0% 100% / 0.24);
          background: hsl(0 0% 100% / 0.06);
        }
        .lm-composer__send {
          width: 46px; height: 46px;
          display: inline-flex; align-items: center; justify-content: center;
          background: hsl(0 0% 100%);
          color: hsl(234 22% 4%);
          border-radius: 14px;
          transition: opacity var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-composer__send:disabled { opacity: 0.3; }
        .lm-composer__send:not(:disabled):hover {
          box-shadow: 0 0 20px hsl(0 0% 100% / 0.4);
        }

        /* === Sora rail === */
        .lm-sora {
          border-left: 1px solid hsl(0 0% 100% / 0.06);
          background: hsl(234 22% 4% / 0.4);
          backdrop-filter: blur(14px);
          padding: 28px 16px;
          display: flex; flex-direction: column;
          gap: 24px;
          min-height: 0;
          overflow-y: auto;
        }
        .lm-sora__top { display: flex; flex-direction: column; align-items: center; padding-top: 12px; }
        .lm-sora__tools {
          border-top: 1px solid hsl(0 0% 100% / 0.06);
          padding-top: 14px;
        }
        .lm-sora__tool {
          padding: 6px 10px;
          font-size: 11px;
          color: hsl(0 0% 100% / 0.8);
          border: 1px solid hsl(0 0% 100% / 0.10);
          border-radius: 8px;
          margin-bottom: 6px;
          font-family: "SF Mono", ui-monospace, monospace;
        }
        .lm-sora__agent {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px;
          background: hsl(0 0% 100% / 0.03);
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: 10px;
          margin-bottom: 6px;
        }
        .lm-sora__agent[data-spawn="true"] {
          background: hsl(0 0% 100% / 0.05);
          border-color: hsl(0 0% 100% / 0.16);
        }
      `}</style>
    </div>
  );
}

function orbStateLabel(s: OrbState): string {
  return {
    idle: "Idle",
    thinking: "Thinking…",
    tool: "Running a tool",
    spawn: "Coordinating",
    suspended: "Suspended",
    error: "Recovering",
  }[s];
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-6 lm-body h-full" style={{ color: "hsl(0 0% 100% / 0.5)" }}>Loading…</div>}>
      <div className="h-full min-h-0">
        <ChatInner />
      </div>
    </Suspense>
  );
}
