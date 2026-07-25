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

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Textarea } from "@/components/ui";
import { ToolCallCard, type ToolCallState } from "@/components/chat/tool-call-card";
import { ConfirmationCard, type ConfirmationState } from "@/components/chat/confirmation-card";
import { SpeakerButton, speak } from "@/components/chat/tts";
import { toast } from "@/components/toast";
import { Orb, type OrbState } from "@/components/orb";
import { Plus, Send, Trash2, Star, Copy, RefreshCw, Volume2, Download, Paperclip, X, Minimize2, Eraser } from "lucide-react";
import { modelSupportsVisionSync } from "@/lib/models/vision";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchSettings, patchSettingsCache } from "@/lib/client/settings-cache";
import { readChatBoot, writeChatBoot } from "@/lib/client/chat-boot-cache";

const MarkdownBody = dynamic(
  () => import("@/components/chat/markdown-body").then((m) => m.MarkdownBody),
  { ssr: false }
);
const MicButton = dynamic(
  () => import("@/components/chat/voice").then((m) => ({ default: m.MicButton })),
  { ssr: false, loading: () => null }
);
const ConversationButton = dynamic(
  () => import("@/components/chat/voice").then((m) => ({ default: m.ConversationButton })),
  { ssr: false, loading: () => null }
);

type Conversation = { id: string; title: string; updated_at: number; starred: number };
type Attachment = { name: string; mime: string; data: string; url: string; kind: "image" | "doc" };
type ThreadItem =
  | { kind: "user"; content: string; images?: string[]; originLabel?: string | null }
  | { kind: "assistant"; content: string; originLabel?: string | null }
  | { kind: "tool"; tc: ToolCallState }
  | { kind: "confirmation"; c: ConfirmationState };

const MAX_ATTACH = 6;
const MAX_IMG_DIM = 1024;
const DOC_ACCEPT =
  "image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt,text/markdown,.md";

function isDocFile(file: File): boolean {
  const t = file.type || "";
  const n = file.name.toLowerCase();
  return (
    t === "application/pdf" ||
    t.includes("wordprocessingml") ||
    t === "text/plain" ||
    t === "text/markdown" ||
    /\.(pdf|docx|txt|md)$/i.test(n)
  );
}

async function fileToDocAttachment(file: File): Promise<Attachment | null> {
  if (!isDocFile(file)) return null;
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const mime =
    file.type ||
    (file.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : file.name.toLowerCase().endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain");
  return {
    name: file.name,
    mime,
    data: dataUrl.replace(/^data:[^;]+;base64,/, ""),
    url: dataUrl,
    kind: "doc",
  };
}

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
    if (!ctx) return { name: file.name, mime: file.type, data: dataUrl.replace(/^data:[^;]+;base64,/, ""), url: dataUrl, kind: "image" };
    ctx.drawImage(img, 0, 0, width, height);
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const out = canvas.toDataURL(mime, 0.85);
    return { name: file.name, mime, data: out.replace(/^data:[^;]+;base64,/, ""), url: out, kind: "image" };
  } catch {
    return { name: file.name, mime: file.type, data: dataUrl.replace(/^data:[^;]+;base64,/, ""), url: dataUrl, kind: "image" };
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
  const confirm = useConfirm();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>("ollama");
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string>("ollama");
  const [convModelOverride, setConvModelOverride] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickerProviders, setPickerProviders] = useState<{ name: string; connected: boolean }[]>([]);
  const [pickerModels, setPickerModels] = useState<{ name: string }[]>([]);
  const [pickerProvider, setPickerProvider] = useState<string>("ollama");
  const [autoRead, setAutoRead] = useState(false);
  const [modelVision, setModelVision] = useState(false);
  const [compacting, setCompacting] = useState(false);
  // Sora is now the only "lead" persona for chat. Sub-agents (Writer, Coder,
  // Researcher, etc.) are summoned by Sora via spawn_subagent. The legacy
  // `persona` value is preserved so the backend keeps routing to the right
  // assembled prompt, but the UI no longer exposes a selector.
  const [persona] = useState("general");
  const [agentMode, setAgentMode] = useState<"auto" | "plan" | "ask">("auto");

  // Fleet chat relay — when a peer is selected, send() routes through
  // /api/fleet/peers/[id]/chat instead of the local streaming /api/chat.
  // Defaults to Auto when any trusted peer is paired.
  type FleetPeer = {
    peer_node_id: string;
    label: string | null;
    primary_addr: string | null;
    paired_at: number;
    last_seen_at: number | null;
    trusted: number;
    policy?: { accept_workspace_relay?: boolean; accept_chat_relay?: boolean };
    capabilities?: { accepts_workspace_relay?: boolean; accepts_chat_relay?: boolean };
  };
  const [peers, setPeers] = useState<FleetPeer[]>([]);
  // null = this machine; "__auto__" = least-loaded across mesh; else peer id
  const [runOnPeer, setRunOnPeer] = useState<string | null>(null);
  const [workspacePeer, setWorkspacePeer] = useState<string>("");
  // Where personal-assistant tools run when compute is on a peer. Default to
  // "this device" so a hub (e.g. DGX) does the thinking while files / calendar
  // / mail / browser actions happen on the user's own machine.
  const [toolHome, setToolHome] = useState<"initiator" | "executor">("initiator");
  const [executorHint, setExecutorHint] = useState<string | null>(null);

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

  // Paint model/mode/paperclip from last session before /api/settings returns.
  useLayoutEffect(() => {
    const boot = readChatBoot();
    if (!boot) return;
    if (boot.model) {
      setModel(boot.model);
      setDefaultModel(boot.model);
    }
    if (boot.provider) {
      setProvider(boot.provider);
      setDefaultProvider(boot.provider);
    }
    if (boot.agentMode) setAgentMode(boot.agentMode);
    if (boot.modelVision) setModelVision(true);
    if (boot.toolHome) setToolHome(boot.toolHome);
  }, []);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!modelVision) {
      toast("This model doesn't accept images or documents. Pick a vision / multimodal model first.", "info");
      e.target.value = "";
      return;
    }
    if (files.some((f) => f.type.startsWith("video/"))) {
      toast("Video isn't supported yet — images and documents only.", "info");
    }
    const added: Attachment[] = [];
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        const a = await fileToAttachment(f);
        if (a) added.push(a);
      } else if (isDocFile(f)) {
        const a = await fileToDocAttachment(f);
        if (a) added.push(a);
      }
    }
    if (added.length) setAttachments((cur) => [...cur, ...added].slice(0, MAX_ATTACH));
    else if (files.length) toast("Couldn't attach those files. Try an image, PDF, DOCX, or text file.", "info");
    e.target.value = "";
  }

  // Probe vision/multimodal support whenever the active model changes.
  useEffect(() => {
    let cancelled = false;
    const name = model;
    if (!name) {
      setModelVision(false);
      return;
    }
    // Optimistic heuristic so the paperclip appears immediately for known vision models.
    setModelVision(modelSupportsVisionSync({ name }));
    writeChatBoot({ model: name, provider, modelVision: modelSupportsVisionSync({ name }) });
    (async () => {
      try {
        const r = await fetch(
          `/api/models/capabilities?model=${encodeURIComponent(name)}&provider=${encodeURIComponent(provider || "ollama")}`
        );
        const j = await r.json();
        if (!cancelled) {
          setModelVision(!!j.vision);
          writeChatBoot({ modelVision: !!j.vision });
        }
      } catch {
        /* keep heuristic */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model, provider]);

  // Drop staged attachments when switching to a non-vision model.
  useEffect(() => {
    if (!modelVision && attachments.length) setAttachments([]);
  }, [modelVision]); // eslint-disable-line react-hooks/exhaustive-deps

  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Maps a pending confirmation's toolCallId → the peer that raised it, so
  // decide() can route the answer back over the fleet (M5 remote confirms).
  const remoteConfirmRef = useRef<Map<string, string>>(new Map());

  // Auto-grow the composer to fit its content (up to a cap) so large pastes are
  // visible instead of stuck on one line. Runs on every input change and on
  // programmatic changes (prefill, clear-after-send).
  const autoGrowComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.max(160, Math.round(window.innerHeight * 0.5));
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);
  useEffect(() => { autoGrowComposer(); }, [input, autoGrowComposer]);

  const loadConversations = useCallback(async () => {
    const r = await fetch("/api/conversations");
    const j = await r.json();
    setConversations(j.conversations || []);
  }, []);

  useEffect(() => {
    void fetchSettings()
      .then((settings) => {
        if (settings && !settings.onboarded) {
          window.location.href = "/onboarding";
          return;
        }
        const activeModel = (settings?.active_model as string) || null;
        const prov = (settings?.provider as string) || "ollama";
        const mode = (settings?.agent_mode as "auto" | "plan" | "ask") || "auto";
        setModel(activeModel);
        setDefaultModel(activeModel);
        setProvider(prov);
        setDefaultProvider(prov);
        setAgentMode(mode);
        const cp = settings?.compute_placement as string | undefined;
        if (cp === "local") setRunOnPeer(null);
        else if (cp && cp !== "auto") setRunOnPeer(cp);
        else if (cp === "auto") setRunOnPeer("__auto__");
        const wp = settings?.workspace_placement as string | undefined;
        if (wp && wp !== "local" && wp !== "auto") setWorkspacePeer(wp);
        else setWorkspacePeer("");
        const th = settings?.tool_home_placement as string | undefined;
        const toolHomeNext =
          th === "executor" || th === "initiator" ? th : "initiator";
        setToolHome(toolHomeNext);
        const fs = Number(settings?.chat_font_size);
        if (fs >= 12 && fs <= 28) {
          document.documentElement.style.setProperty("--lm-root-fs", `${fs}px`);
        }
        writeChatBoot({
          model: activeModel,
          provider: prov,
          agentMode: mode,
          modelVision: modelSupportsVisionSync({ name: activeModel || "" }),
          toolHome: toolHomeNext,
        });
      })
      .catch(() => { /* offline — keep boot cache */ });
    loadConversations();
    // Best-effort peer fetch for the "Run on" composer selector. Failure is
    // silent — if the user isn't an owner the endpoint 403s and we just hide
    // the dropdown.
    fetch("/api/fleet/peers")
      .then((r) => (r.ok ? r.json() : { peers: [] }))
      .then((j) => {
        const list = (j.peers as FleetPeer[]) || [];
        setPeers(list);
        if (list.some((p) => p.trusted === 1)) setRunOnPeer("__auto__");
      })
      .catch(() => setPeers([]));
    // Defer mesh conversation sync so first paint + settings aren't starved
    // by slow/offline peers.
    const syncTimer = window.setTimeout(() => {
      fetch("/api/fleet/sync", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.messages > 0) loadConversations();
        })
        .catch(() => { /* no peers / fleet off */ });
    }, 2500);
    return () => window.clearTimeout(syncTimer);
  }, [loadConversations]);

  async function changeMode(next: "auto" | "plan" | "ask") {
    setAgentMode(next);
    writeChatBoot({ agentMode: next });
    patchSettingsCache({ agent_mode: next });
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_mode: next }),
    });
    toast(`Mode → ${next}`, "success");
  }

  async function openModelPicker() {
    setModelPickerOpen(true);
    setPickerProvider(provider || defaultProvider || "ollama");
    const [provRes, modRes] = await Promise.all([
      fetch("/api/providers"),
      fetch(`/api/models?provider=${encodeURIComponent(provider || defaultProvider || "ollama")}`),
    ]);
    const pj = await provRes.json().catch(() => ({ providers: [] }));
    const mj = await modRes.json().catch(() => ({ models: [] }));
    setPickerProviders(pj.providers || []);
    setPickerModels(mj.models || []);
  }

  async function loadPickerModels(p: string) {
    setPickerProvider(p);
    const r = await fetch(`/api/models?provider=${encodeURIComponent(p)}`);
    const j = await r.json().catch(() => ({ models: [] }));
    setPickerModels(j.models || []);
  }

  async function applyChatModel(nextProvider: string, nextModel: string) {
    if (!activeId) {
      // No conversation yet — set global default
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: nextProvider, active_model: nextModel }),
      });
      patchSettingsCache({ provider: nextProvider, active_model: nextModel });
      writeChatBoot({
        provider: nextProvider,
        model: nextModel,
        modelVision: modelSupportsVisionSync({ name: nextModel }),
      });
      setDefaultProvider(nextProvider);
      setDefaultModel(nextModel);
      setProvider(nextProvider);
      setModel(nextModel);
      setConvModelOverride(false);
      setModelPickerOpen(false);
      toast(`Default → ${nextProvider} / ${nextModel}`, "success");
      return;
    }
    await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_provider: nextProvider, model_name: nextModel }),
    });
    writeChatBoot({
      provider: nextProvider,
      model: nextModel,
      modelVision: modelSupportsVisionSync({ name: nextModel }),
    });
    setProvider(nextProvider);
    setModel(nextModel);
    setConvModelOverride(true);
    setModelPickerOpen(false);
    toast(`This chat → ${nextProvider} / ${nextModel}`, "success");
  }

  async function clearChatModelOverride() {
    if (!activeId) return;
    await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clear_model_override: true }),
    });
    setProvider(defaultProvider);
    setModel(defaultModel);
    setConvModelOverride(false);
    setModelPickerOpen(false);
    toast("Using default model", "success");
  }

  useEffect(() => {
    // Avoid useSearchParams Suspense — read once from the URL so chrome paints immediately.
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("new") === "1") void newConversation();
      const ask = sp.get("ask");
      if (ask) setInput(ask);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const openReqRef = useRef(0);
  async function openConversation(id: string) {
    const req = ++openReqRef.current;
    setActiveId(id);
    setError(null);
    setSuspendedNotice(null);
    const r = await fetch(`/api/conversations/${id}`);
    if (req !== openReqRef.current) return; // stale — a newer open won
    const j = await r.json();
    if (req !== openReqRef.current) return;
    const conv = j.conversation;
    if (conv?.model_name || conv?.model_provider) {
      setConvModelOverride(true);
      setModel(conv.model_name || defaultModel);
      setProvider(conv.model_provider || defaultProvider);
    } else {
      setConvModelOverride(false);
      setModel(defaultModel);
      setProvider(defaultProvider);
    }
    const cp = conv?.compute_placement;
    if (cp === "local") setRunOnPeer(null);
    else if (cp && cp !== "auto") setRunOnPeer(cp);
    else if (cp === "auto") setRunOnPeer("__auto__");
    const wp = conv?.workspace_placement;
    if (wp && wp !== "local" && wp !== "auto") setWorkspacePeer(wp);
    else if (wp === "local" || wp === "") setWorkspacePeer("");
    const items: ThreadItem[] = [];
    for (const m of j.messages || []) {
      const origin = m.origin_label || null;
      if (m.role === "user") items.push({ kind: "user", content: m.content, images: attachmentsToImageUrls(m.attachments), originLabel: origin });
      else if (m.role === "assistant") items.push({ kind: "assistant", content: m.content, originLabel: origin });
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
        if (req !== openReqRef.current) return;
        if (j?.suspended) setSuspendedNotice({ reason: j.reason ?? "Suspended", tool: j.tool ?? "" });
      });
  }

  async function newConversation() {
    if (creatingConversation) return;
    const tempId = `tmp-${Date.now()}`;
    setCreatingConversation(true);
    setActiveId(tempId);
    setThread([]);
    setSuspendedNotice(null);
    setConversations((cur) => [
      { id: tempId, title: "New chat", updated_at: Date.now(), starred: 0 },
      ...cur.filter((c) => c.id !== tempId),
    ]);
    try {
      const r = await fetch("/api/conversations", { method: "POST" });
      if (!r.ok) throw new Error(`conversation ${r.status}`);
      const j = await r.json();
      const real = j.conversation as Conversation;
      if (!real?.id) throw new Error("Missing conversation id");
      setConversations((cur) => [
        real,
        ...cur.filter((c) => c.id !== tempId && c.id !== real.id),
      ]);
      setActiveId(real.id);
    } catch {
      setConversations((cur) => cur.filter((c) => c.id !== tempId));
      setActiveId(null);
      toast("Could not start a new chat", "error");
    } finally {
      setCreatingConversation(false);
    }
  }

  async function deleteConversation(id: string) {
    const r = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleted: true }),
    });
    if (r.status === 409) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "This conversation can't be deleted (peer-relayed).", "error");
      return;
    }
    if (!r.ok) {
      toast("Could not delete conversation", "error");
      return;
    }
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

  async function clearChat() {
    if (!activeId || streaming) return;
    const ok = await confirm({
      title: "Clear this chat?",
      message: "All messages in this conversation will be removed. The chat itself stays in the sidebar.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/conversations/${activeId}/clear`, { method: "POST" });
    if (!r.ok) {
      toast("Could not clear chat", "error");
      return;
    }
    setThread([]);
    setAttachments([]);
    toast("Chat cleared", "success");
  }

  async function compactChat() {
    if (!activeId || streaming || compacting) return;
    const ok = await confirm({
      title: "Compact this chat?",
      message: "Older turns will be summarized and dropped so the model has more room. Recent messages stay.",
      confirmLabel: "Compact",
    });
    if (!ok) return;
    setCompacting(true);
    try {
      const r = await fetch(`/api/conversations/${activeId}/compact`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(j.error || "Could not compact chat", "error");
        return;
      }
      if (!j.compacted) {
        toast(j.reason || "Nothing to compact", "info");
        return;
      }
      toast(`Compacted — dropped ${j.dropped} older messages`, "success");
      await openConversation(activeId);
    } finally {
      setCompacting(false);
    }
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
    // Keep the confirmation card until the server accepts — a wrong PIN must
    // leave the card in place so the user can retry (otherwise the agent hangs
    // until the confirmation timeout with no UI left).
    const remotePeer = remoteConfirmRef.current.get(toolCallId);
    if (remotePeer) {
      // Confirmation was raised by a compute peer — relay the answer back.
      const rr = await fetch(`/api/fleet/peers/${remotePeer}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool_call_id: toolCallId, decision, pin }),
      });
      const j = await rr.json().catch(() => ({}));
      if (!rr.ok || j.matched === false) {
        toast(j.error || "Remote confirmation failed", "error");
        return;
      }
      remoteConfirmRef.current.delete(toolCallId);
      setThread((t) => t.filter((i) => !(i.kind === "confirmation" && i.c.toolCallId === toolCallId)));
      return;
    }
    const r = await fetch("/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolCallId, decision, pin }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Confirmation failed", "error");
      return;
    }
    setThread((t) => t.filter((i) => !(i.kind === "confirmation" && i.c.toolCallId === toolCallId)));
  }

  // === Streaming ===
  async function streamChat(convId: string, body: any) {
    setStreaming(true);
    setStreamPhase("preparing");
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
          if (ev.type === "done" || ev.type === "error" || ev.type === "loop_suspended") gotDone = true;
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
      setStreamPhase(null);
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
    if (!cleaned || creatingConversation || streaming) return;
    setStreaming(true);
    setStreamPhase("preparing");
    setInput("");
    setThread((t) => [...t, { kind: "user", content: cleaned }, { kind: "assistant", content: "" }]);
    let convId = activeId;
    if (!convId) {
      try {
        const r = await fetch("/api/conversations", { method: "POST" });
        convId = (await r.json()).conversation.id;
        setActiveId(convId!);
      } catch (e) {
        setStreaming(false);
        setStreamPhase(null);
        setError((e as Error).message || "Could not start conversation");
        return;
      }
    }
    streamChat(convId!, { message: cleaned, persona });
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || creatingConversation || streaming) return;
    const outgoing = attachments;
    const images = outgoing.map((a) => ({ name: a.name, mime: a.mime, data: a.data }));

    // Paint the turn + typing state BEFORE any network — the previous path
    // awaited conversation create / fleet placement with a blank thread.
    setStreaming(true);
    setStreamPhase("preparing");
    setError(null);
    setInput("");
    setAttachments([]);
    setThread((t) => [
      ...t,
      {
        kind: "user",
        content: text || (outgoing.some((a) => a.kind === "doc") ? outgoing.filter((a) => a.kind === "doc").map((a) => `Attached: ${a.name}`).join("\n") : ""),
        images: outgoing.filter((a) => a.kind === "image").length
          ? outgoing.filter((a) => a.kind === "image").map((a) => a.url)
          : undefined,
      },
      { kind: "assistant", content: "" },
    ]);

    let convId = activeId;
    if (!convId) {
      try {
        const r = await fetch("/api/conversations", { method: "POST" });
        convId = (await r.json()).conversation.id;
        setActiveId(convId!);
      } catch (e) {
        setStreaming(false);
        setStreamPhase(null);
        setError((e as Error).message || "Could not start conversation");
        return;
      }
    }

    // Fleet chat relay: explicit peer, or Auto (least-loaded across the mesh).
    let peerTarget = runOnPeer;
    setExecutorHint(null);
    if (peerTarget === "__auto__") {
      try {
        const place = await fetch(
          `/api/fleet/chat-placement${convId ? `?conversation_id=${encodeURIComponent(convId)}` : ""}`
        ).then((r) => r.json());
        if (place?.kind === "peer" && place.peer_node_id) {
          peerTarget = place.peer_node_id;
          setExecutorHint(`Auto → ${place.label || place.peer_node_id.slice(0, 12)}`);
        } else {
          peerTarget = null;
          setExecutorHint("Auto → this machine");
        }
      } catch {
        peerTarget = null;
      }
    }
    if (peerTarget) {
      try {
        const peerLabel =
          peers.find((p) => p.peer_node_id === peerTarget)?.label || peerTarget.slice(0, 12);
        setExecutorHint(
          toolHome === "initiator"
            ? `Waiting on ${peerLabel}… (tools on this device)`
            : `Waiting on ${peerLabel}…`
        );
        setStreamPhase("preparing");
        const res = await fetch(`/api/fleet/peers/${peerTarget}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            conversation_id: convId,
            message: text,
            persona_id: persona,
            tool_home: toolHome,
            ...(images.length ? { images } : {}),
          }),
        });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok && !ct.includes("text/event-stream")) {
          const j = await res.json().catch(() => ({}));
          setError((j as { error?: string }).error ?? `Peer returned ${res.status}`);
          setThread((t) => {
            const out = [...t];
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].kind === "assistant") { out.splice(i, 1); break; }
            }
            return out;
          });
        } else if (ct.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let reply: string | null = null;
          let errMsg: string | null = null;
          let label = peerLabel;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() || "";
            for (const part of parts) {
              const line = part.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "status") {
                  if (ev.peer_label) label = ev.peer_label;
                  if (ev.phase === "relay_started") setExecutorHint(`Waiting on ${label}…`);
                  if (ev.phase === "receiving") setExecutorHint(`Receiving from ${label}…`);
                } else if (ev.type === "token" && typeof ev.text === "string") {
                  setStreamPhase("streaming");
                  setExecutorHint(`Receiving from ${label}…`);
                  setThread((t) => {
                    const out = [...t];
                    for (let i = out.length - 1; i >= 0; i--) {
                      if (out[i].kind === "assistant") {
                        const prev = out[i] as { kind: "assistant"; content: string; originLabel?: string };
                        out[i] = {
                          kind: "assistant",
                          content: (prev.content || "") + ev.text,
                          originLabel: label,
                        };
                        break;
                      }
                    }
                    return out;
                  });
                } else if (ev.type === "confirm" && ev.tool_call_id) {
                  // Executor raised an ask/pin gate; surface it locally and
                  // remember the peer so decide() relays the answer back.
                  remoteConfirmRef.current.set(ev.tool_call_id, peerTarget as string);
                  setExecutorHint(`Waiting for your approval (via ${label})…`);
                  setStreamPhase("waiting_confirmation");
                  setThread((t) => [
                    ...t,
                    {
                      kind: "confirmation",
                      c: {
                        toolCallId: ev.tool_call_id,
                        actionType: ev.action_type || "action",
                        preview: ev.preview || "",
                        timeoutSeconds: ev.timeout_seconds ?? 60,
                        requiresPin: !!ev.requires_pin,
                        peerLabel: label,
                      },
                    },
                  ]);
                } else if (
                  (ev.type === "confirm_timeout" || ev.type === "confirm_denied") &&
                  ev.tool_call_id
                ) {
                  remoteConfirmRef.current.delete(ev.tool_call_id);
                  setExecutorHint(`Receiving from ${label}…`);
                  setStreamPhase("streaming");
                  setThread((t) =>
                    t.filter((i) => !(i.kind === "confirmation" && i.c.toolCallId === ev.tool_call_id))
                  );
                } else if (ev.type === "done") {
                  reply = ev.reply ?? "";
                  if (ev.peer_label) label = ev.peer_label;
                } else if (ev.type === "error") {
                  errMsg = ev.message || "Relay failed.";
                }
              } catch { /* ignore malformed SSE chunk */ }
            }
          }
          if (errMsg) {
            remoteConfirmRef.current.clear();
            setError(errMsg);
            setThread((t) => {
              const out = t.filter((i) => i.kind !== "confirmation");
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].kind === "assistant") { out.splice(i, 1); break; }
              }
              return out;
            });
          } else if (reply != null) {
            setThread((t) => {
              const out = [...t];
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].kind === "assistant") {
                  out[i] = { kind: "assistant", content: reply!, originLabel: label };
                  break;
                }
              }
              return out;
            });
          }
        } else {
          const j = await res.json();
          if (!res.ok) {
            remoteConfirmRef.current.clear();
            setError(j.error ?? `Peer returned ${res.status}`);
            setThread((t) => {
              const out = t.filter((i) => i.kind !== "confirmation");
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].kind === "assistant") { out.splice(i, 1); break; }
              }
              return out;
            });
          } else {
            setThread((t) => {
              const out = [...t];
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].kind === "assistant") {
                  out[i] = { kind: "assistant", content: j.reply, originLabel: peerLabel };
                  break;
                }
              }
              return out;
            });
          }
        }
      } catch (e) {
        remoteConfirmRef.current.clear();
        setError((e as Error).message);
        setThread((t) => t.filter((i) => i.kind !== "confirmation"));
      } finally {
        setStreaming(false);
        setStreamPhase(null);
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
    if (ev.type === "status") {
      setStreamPhase(ev.phase || "thinking");
      if (ev.phase === "thinking" || ev.phase === "receiving") setStreamPhase(ev.phase);
      return;
    }
    if (ev.type === "context_compressed") {
      toast("Older turns were summarized to free context", "info");
      return;
    }
    if (ev.type === "text_chunk") {
      setStreamPhase("streaming");
    }
    if (ev.type === "tool_call_start") {
      setActiveTools((m) => ({ ...m, [ev.toolCallId]: ev.toolName }));
      setStreamPhase("tool");
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
        <button
          onClick={newConversation}
          disabled={creatingConversation}
          className="lm-conv__new"
          data-pulse="true"
        >
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
          <div className="flex items-center gap-3 flex-wrap">
            <span className="lm-micro">Model</span>
            <button
              type="button"
              onClick={() => (modelPickerOpen ? setModelPickerOpen(false) : openModelPicker())}
              className="lm-body"
              style={{ color: "hsl(0 0% 100% / 0.92)", textDecoration: "underline", textUnderlineOffset: 3 }}
              data-pulse="true"
              title="Pick provider and model for this chat"
            >
              {provider ? `${provider}/` : ""}{model || "—"}
              {convModelOverride ? " · chat" : ""}
            </button>
            {modelPickerOpen && (
              <div
                className="absolute z-40 mt-10 left-4 right-4 max-w-md rounded-lg border bg-background p-3 shadow-lg"
                style={{ top: "var(--lm-thread-head-top, 3rem)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Provider & model</span>
                  <button type="button" className="text-xs text-muted-foreground" onClick={() => setModelPickerOpen(false)}>Close</button>
                </div>
                <select
                  className="w-full mb-2 h-8 rounded border bg-background px-2 text-sm"
                  value={pickerProvider}
                  onChange={(e) => loadPickerModels(e.target.value)}
                >
                  {(pickerProviders.length ? pickerProviders : [{ name: pickerProvider, connected: true }]).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.connected === false ? " (no key)" : ""}
                    </option>
                  ))}
                </select>
                <div className="max-h-40 overflow-y-auto space-y-1 mb-2">
                  {pickerModels.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No models listed. Add a key in Settings or pull a local model.</p>
                  ) : (
                    pickerModels.map((m) => (
                      <button
                        key={m.name}
                        type="button"
                        className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-accent"
                        onClick={() => applyChatModel(pickerProvider, m.name)}
                      >
                        {m.name}
                      </button>
                    ))
                  )}
                </div>
                {convModelOverride && (
                  <button type="button" className="text-xs underline" onClick={clearChatModelOverride}>
                    Clear chat override (use default)
                  </button>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Default: {defaultProvider}/{defaultModel || "—"} · <a href="/models" className="underline">Models</a>
                </p>
              </div>
            )}
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
            <div className="flex items-center gap-2">
              {thread.length > 0 && (
                <>
                  <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.4)", textTransform: "none" }}>
                    {thread.filter((t) => t.kind === "user" || t.kind === "assistant").length} turns
                  </span>
                  <button
                    type="button"
                    onClick={compactChat}
                    disabled={streaming || compacting || thread.length < 8}
                    className="lm-thread__export"
                    title="Summarize older turns and free context"
                    data-pulse="true"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span className="lm-micro">{compacting ? "Compacting…" : "Compact"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearChat}
                    disabled={streaming}
                    className="lm-thread__export"
                    title="Clear all messages in this chat"
                    data-pulse="true"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    <span className="lm-micro">Clear</span>
                  </button>
                </>
              )}
              <a href={`/api/conversations/${activeId}/export`} className="lm-thread__export" data-pulse="true">
                <Download className="h-3.5 w-3.5" />
                <span className="lm-micro">Export</span>
              </a>
            </div>
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
                    {item.originLabel && (
                      <p className="lm-micro mb-1 text-right" style={{ color: "hsl(0 0% 100% / 0.35)", textTransform: "none", letterSpacing: 0 }}>
                        from {item.originLabel}
                      </p>
                    )}
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
              if (item.kind === "assistant") {
                const isLive = streaming && i === thread.length - 1;
                if (!item.content) {
                  if (!isLive) return null;
                  return (
                    <div key={i} className="lm-turn lm-turn--assistant">
                      <div className="lm-typing" aria-live="polite" aria-label="Sora is responding">
                        <span />
                        <span />
                        <span />
                      </div>
                      {streamPhase && streamPhase !== "streaming" && (
                        <p className="lm-micro mt-2" style={{ color: "hsl(0 0% 100% / 0.35)", textTransform: "none", letterSpacing: 0 }}>
                          {streamPhase === "preparing" ? "Preparing…" :
                           streamPhase === "tool" ? "Using a tool…" :
                           streamPhase === "thinking" ? "Thinking…" :
                           streamPhase === "waiting_confirmation" ? "Waiting for your approval…" :
                           "Working…"}
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={i} className="lm-turn lm-turn--assistant group">
                    {item.originLabel && (
                      <p className="lm-micro mb-1" style={{ color: "hsl(0 0% 100% / 0.35)", textTransform: "none", letterSpacing: 0 }}>
                        via {item.originLabel}
                      </p>
                    )}
                    {isLive ? (
                      <div className="lm-stream-plain" style={{ whiteSpace: "pre-wrap" }}>{item.content}</div>
                    ) : (
                      <div className="markdown">
                        <MarkdownBody>{item.content}</MarkdownBody>
                      </div>
                    )}
                    {!isLive && (
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
                    )}
                  </div>
                );
              }
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
            <div className="mx-auto flex flex-wrap items-center gap-2 mb-2" style={{ maxWidth: 720 }}>
              <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Run on</span>
              <select
                value={runOnPeer ?? ""}
                onChange={async (e) => {
                  const v = e.target.value || null;
                  setRunOnPeer(v);
                  const compute_placement =
                    !v ? "local" : v === "__auto__" ? "auto" : v;
                  if (activeId) {
                    await fetch(`/api/conversations/${activeId}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ compute_placement }),
                    });
                  } else {
                    patchSettingsCache({ compute_placement });
                    await fetch("/api/settings", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ compute_placement }),
                    });
                  }
                }}
                className="lm-peer-select"
                aria-label="Choose which machine runs this turn"
              >
                <option value="">This machine</option>
                <option value="__auto__">Auto — least loaded</option>
                {peers.map((p) => (
                  <option key={p.peer_node_id} value={p.peer_node_id}>
                    {p.label || p.peer_node_id.slice(0, 12)}
                  </option>
                ))}
              </select>
              <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Workspace</span>
              <select
                value={workspacePeer}
                onChange={async (e) => {
                  const v = e.target.value;
                  setWorkspacePeer(v);
                  if (activeId) {
                    await fetch(`/api/conversations/${activeId}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ workspace_placement: v || "local" }),
                    });
                  } else {
                    patchSettingsCache({ workspace_placement: v || "local" });
                    await fetch("/api/settings", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ workspace_placement: v || "local" }),
                    });
                  }
                }}
                className="lm-peer-select"
                aria-label="Choose which machine holds the git workspace"
              >
                <option value="">This machine</option>
                {peers
                  .filter(
                    (p) =>
                      p.capabilities?.accepts_workspace_relay === true ||
                      p.policy?.accept_workspace_relay === true
                  )
                  .map((p) => (
                    <option key={`ws-${p.peer_node_id}`} value={p.peer_node_id}>
                      {p.label || p.peer_node_id.slice(0, 12)}
                    </option>
                  ))}
              </select>
              {runOnPeer && (
                <>
                  <span className="lm-micro" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Tools</span>
                  <select
                    value={toolHome}
                    onChange={async (e) => {
                      const v = e.target.value as "initiator" | "executor";
                      setToolHome(v);
                      writeChatBoot({ toolHome: v });
                      patchSettingsCache({ tool_home_placement: v });
                      await fetch("/api/settings", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ tool_home_placement: v }),
                      }).catch(() => null);
                    }}
                    className="lm-peer-select"
                    aria-label="Choose which machine runs personal-assistant tools"
                    title="When compute runs on a peer, choose whether files / calendar / mail / browser actions happen on this device or on the compute peer. Requires 'Accept tool relay' on this device (Fleet → peer policy)."
                  >
                    <option value="initiator">On this device</option>
                    <option value="executor">On compute peer</option>
                  </select>
                </>
              )}
              {runOnPeer && toolHome === "initiator" && (
                <span
                  className="lm-micro"
                  style={{ color: "hsl(200 40% 70%)", textTransform: "none", letterSpacing: 0 }}
                  title="The model thinks on the compute peer; files, calendar, mail, and browser actions run here."
                >
                  tools stay here
                </span>
              )}
              {executorHint && (
                <span className="lm-micro" style={{ color: "hsl(160 40% 70%)", textTransform: "none", letterSpacing: 0 }}>
                  {executorHint}
                </span>
              )}
              {runOnPeer && runOnPeer !== "__auto__" && (() => {
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
              {runOnPeer === "__auto__" && (
                <span
                  className="lm-micro"
                  style={{ color: "hsl(40 80% 70%)", textTransform: "none", letterSpacing: 0 }}
                  title="Picks the freshest peer with the lowest active load; ties stay local."
                >
                  ↗ mesh placement
                </span>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mx-auto flex flex-wrap gap-2 mb-2" style={{ maxWidth: 720 }}>
              {attachments.map((a, i) => (
                <div key={i} className="relative">
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} className="h-16 w-16 object-cover rounded-lg border border-white/10" />
                  ) : (
                    <div
                      className="h-16 min-w-[4rem] max-w-[9rem] px-2 rounded-lg border border-white/10 flex flex-col items-center justify-center text-center"
                      style={{ background: "hsl(0 0% 100% / 0.06)" }}
                      title={a.name}
                    >
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
                        {a.name.split(".").pop() || "doc"}
                      </span>
                      <span className="text-[11px] truncate w-full" style={{ color: "hsl(0 0% 100% / 0.85)" }}>
                        {a.name}
                      </span>
                    </div>
                  )}
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
              accept={DOC_ACCEPT}
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
            {modelVision && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || attachments.length >= MAX_ATTACH}
                className="lm-composer__send"
                style={{ background: "hsl(0 0% 100% / 0.06)", color: "hsl(0 0% 100% / 0.9)" }}
                aria-label="Attach image or document"
                title="Attach images, PDFs, or documents (this model is multimodal)"
                data-pulse="true"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            )}
            <Textarea
              ref={composerRef}
              rows={1}
              placeholder={runOnPeer ? "Message Sora on the selected peer…" : "Message Sora…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="lm-composer__input"
              data-pulse="false"
            />
            <MicButton onText={(t, opts) => setInput((prev) => (opts?.append && prev ? `${prev} ${t}` : t))} />
            <button
              onClick={send}
              disabled={creatingConversation || streaming || (!input.trim() && attachments.length === 0)}
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
                      {name.replace(/^spawn_subagent(s_(parallel|sequential))?$/, name.includes("sequential") ? "spawning sequentially…" : name.includes("parallel") ? "spawning batch…" : "spawning…")}
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
        .lm-stream-plain {
          font-size: inherit;
          line-height: inherit;
          color: hsl(0 0% 100% / 0.92);
        }
        .lm-typing {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 10px 4px;
        }
        .lm-typing span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: hsl(0 0% 100% / 0.55);
          animation: lm-typing-bounce 1.1s ease-in-out infinite;
        }
        .lm-typing span:nth-child(2) { animation-delay: 0.15s; }
        .lm-typing span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes lm-typing-bounce {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lm-typing span { animation: none; opacity: 0.6; }
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
          max-height: 50vh;
          overflow-y: auto;
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
    <div className="h-full min-h-0">
      <ChatInner />
    </div>
  );
}
