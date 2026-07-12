"use client";
/**
 * AppBrowser — real Chromium tabs, rendered when LocalMind runs inside its
 * Electron shell (feature-detected via window.lmBrowser from the preload).
 *
 * The actual page pixels are NOT in this React tree: Electron positions a
 * WebContentsView over the placeholder div below. This component owns the
 * chrome — tab strip, URL bar, nav buttons — and keeps the native view
 * glued to the placeholder via ResizeObserver → setBounds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import { BrowseSoraPanel } from "@/components/browse/sora-panel";
import { Orb } from "@/components/orb";
import { toast } from "@/components/toast";
import { ArrowLeft, ArrowRight, RotateCw, Plus, X, Globe, Loader2, Eye, EyeOff, PanelRightClose } from "lucide-react";

const SORA_OPEN_KEY = "lm-browse-sora-open";

type TabInfo = {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};
type BrowserState = { activeTabId: number | null; tabs: TabInfo[] };

type LmBrowser = {
  newTab: (url?: string) => Promise<number>;
  closeTab: (id: number) => Promise<void>;
  selectTab: (id: number) => Promise<void>;
  navigate: (id: number, url: string) => Promise<void>;
  back: (id: number) => Promise<void>;
  forward: (id: number) => Promise<void>;
  reload: (id: number) => Promise<void>;
  setBounds: (b: { x: number; y: number; width: number; height: number }) => Promise<void>;
  setVisible: (v: boolean) => Promise<void>;
  getState: () => Promise<BrowserState>;
  getTargetId: (id: number) => Promise<string | null>;
  onState: (cb: (s: BrowserState) => void) => () => void;
};

export function getLmBrowser(): LmBrowser | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { lmBrowser?: LmBrowser }).lmBrowser ?? null;
}

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  // Words with spaces or no dot → search; otherwise treat as a host.
  if (/\s/.test(u) || !u.includes(".")) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(u)}`;
  }
  return `https://${u}`;
}

export function AppBrowser() {
  const lm = getLmBrowser()!;
  const [state, setState] = useState<BrowserState>({ activeTabId: null, tabs: [] });
  const [urlInput, setUrlInput] = useState("");
  const [editing, setEditing] = useState(false);
  // tabId → browse sessionId for tabs the user granted Sora access to.
  // Grants are per-tab and die with the tab (or on explicit revoke) — no
  // standing access. The indicator below is driven by this map.
  const [grants, setGrants] = useState<Record<number, string>>({});
  const [granting, setGranting] = useState(false);
  // Sora panel visibility. Persisted so the choice survives app restarts.
  // The panel stays mounted when hidden (collapsed to zero width) so the
  // conversation and any active tab grant survive hide→show.
  const [soraOpen, setSoraOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const activeSessionId = active ? grants[active.id] ?? null : null;

  async function toggleGrant() {
    if (!active || granting) return;
    setGranting(true);
    try {
      const targetId = await lm.getTargetId(active.id);
      if (!targetId) { toast("Could not identify this tab", "error"); return; }
      if (grants[active.id]) {
        await fetch("/api/browse/app-tab", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetId, action: "revoke" }),
        });
        setGrants((g) => { const n = { ...g }; delete n[active.id]; return n; });
      } else {
        const r = await fetch("/api/browse/app-tab", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetId, action: "grant" }),
        });
        const j = await r.json();
        if (!r.ok) { toast(j.error || "Grant failed", "error"); return; }
        setGrants((g) => ({ ...g, [active.id]: j.sessionId }));
      }
    } finally {
      setGranting(false);
    }
  }

  // Closing a granted tab revokes it server-side (best-effort) and locally.
  useEffect(() => {
    const openIds = new Set(state.tabs.map((t) => t.id));
    for (const idStr of Object.keys(grants)) {
      const id = Number(idStr);
      if (!openIds.has(id)) {
        setGrants((g) => { const n = { ...g }; delete n[id]; return n; });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tabs]);

  // Restore persisted panel state on mount.
  useEffect(() => {
    if (localStorage.getItem(SORA_OPEN_KEY) === "0") setSoraOpen(false);
  }, []);

  const toggleSora = useCallback(() => {
    setSoraOpen((prev) => {
      const next = !prev;
      localStorage.setItem(SORA_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // Keep the native view glued to the placeholder.
  const syncBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    lm.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
  }, [lm]);

  // Reclaim/relinquish width for the native WebContentsView when the panel
  // toggles. The layout transition takes a frame to settle, so re-sync on the
  // next frame (the ResizeObserver also fires, but this guarantees it).
  useEffect(() => {
    const t = requestAnimationFrame(syncBounds);
    return () => cancelAnimationFrame(t);
  }, [soraOpen, syncBounds]);

  // ⌘/ (or Ctrl+/) toggles the Sora panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggleSora();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSora]);

  useEffect(() => {
    const off = lm.onState(setState);
    lm.getState().then(setState);
    lm.setVisible(true);
    syncBounds();
    const ro = new ResizeObserver(syncBounds);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", syncBounds);
    return () => {
      off();
      ro.disconnect();
      window.removeEventListener("resize", syncBounds);
      // Leaving /browse must hide the native view or it would float over
      // whatever LocalMind page comes next.
      lm.setVisible(false);
    };
  }, [lm, syncBounds]);

  // URL bar mirrors the active tab unless the user is typing.
  useEffect(() => {
    if (!editing) setUrlInput(active?.url === "about:blank" ? "" : active?.url ?? "");
  }, [active?.url, editing]);

  function go() {
    const target = normalizeUrl(urlInput);
    if (!target) return;
    setEditing(false);
    if (active) lm.navigate(active.id, target);
    else lm.newTab(target);
  }

  return (
    <div className="flex h-[100dvh]">
    <div className="relative flex flex-col flex-1 min-w-0">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-2 pt-2 shrink-0 overflow-x-auto">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => lm.selectTab(t.id)}
            className={`group flex items-center gap-1.5 max-w-[200px] rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs cursor-pointer select-none shrink-0 ${
              t.id === state.activeTabId
                ? "bg-background border-border"
                : "bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {grants[t.id]
              ? <Eye className="h-3 w-3 shrink-0 text-emerald-400" aria-label="Sora can see this tab" />
              : t.loading
              ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              : <Globe className="h-3 w-3 shrink-0 opacity-60" />}
            <span className="truncate">{t.title || t.url || "New tab"}</span>
            <button
              onClick={(e) => { e.stopPropagation(); lm.closeTab(t.id); }}
              className="opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"
              aria-label="Close tab"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={() => { lm.newTab(); setUrlInput(""); setEditing(true); }}
          className="p-1.5 rounded hover:bg-muted/60 shrink-0"
          aria-label="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Nav bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b shrink-0">
        <Button size="sm" variant="ghost" disabled={!active?.canGoBack} onClick={() => active && lm.back(active.id)} aria-label="Back">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" disabled={!active?.canGoForward} onClick={() => active && lm.forward(active.id)} aria-label="Forward">
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" disabled={!active} onClick={() => active && lm.reload(active.id)} aria-label="Reload">
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <Input
          className="flex-1 h-8 text-sm"
          placeholder="Search or enter address"
          value={urlInput}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        />
        <Button
          size="sm"
          variant={activeSessionId ? "default" : "outline"}
          disabled={!active || granting}
          onClick={toggleGrant}
          className="inline-flex items-center gap-1.5 shrink-0"
          title={activeSessionId
            ? "Sora can see and act on this tab. Click to revoke."
            : "Grant Sora access to this tab so it can read and act on the page."}
        >
          {granting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : activeSessionId ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {activeSessionId ? "Sora sees this" : "Grant Sora"}
        </Button>
      </div>

      {/* Non-spoofable watching indicator: drawn by LocalMind's chrome,
          above the WebContentsView — page content cannot draw here. */}
      {activeSessionId && (
        <button
          onClick={toggleGrant}
          className="shrink-0 flex items-center justify-center gap-1.5 bg-emerald-500/15 text-emerald-500 border-b border-emerald-500/30 text-[11px] py-0.5 hover:bg-emerald-500/25"
          title="Click to revoke"
        >
          <Eye className="h-3 w-3" /> Sora can see and act on this tab
        </button>
      )}

      {/* Placeholder the WebContentsView is glued to */}
      <div ref={contentRef} className="flex-1 min-h-0 bg-muted/20 flex items-center justify-center">
        {state.tabs.length === 0 && (
          <p className="text-sm text-muted-foreground">Open a tab to start browsing — ⌘-click links open here too.</p>
        )}
      </div>

      {/* Floating "Ask Sora" affordance — only when the panel is hidden.
          Anchored to the browser content area so it never covers the
          non-spoofable grant strip above. */}
      {!soraOpen && (
        <button
          onClick={toggleSora}
          className="absolute bottom-4 right-4 z-10 hidden md:inline-flex items-center gap-2 rounded-full border border-border bg-background/90 backdrop-blur px-3 py-2 text-sm shadow-lg hover:bg-muted/70"
          title="Ask Sora (⌘/)"
        >
          <Orb size={22} state="idle" />
          Ask Sora
        </button>
      )}
    </div>

    {/* Sora rides along: plain chat always; page sight/hands only for the
        granted tab (activeSessionId → browse_session tools server-side).
        Kept mounted but collapsed to zero width when hidden so conversation
        state and the tab grant survive hide→show. */}
    <div
      className={`relative shrink-0 flex-col ${
        soraOpen ? "w-[min(380px,32vw)] hidden md:flex" : "w-0 overflow-hidden flex"
      }`}
    >
      {soraOpen && (
        <button
          onClick={toggleSora}
          className="absolute top-2 right-2 z-10 p-1.5 rounded hover:bg-muted/60 text-muted-foreground"
          title="Hide Sora (⌘/)"
          aria-label="Hide Sora panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      )}
      <BrowseSoraPanel browseSessionId={activeSessionId} />
    </div>
    </div>
  );
}
