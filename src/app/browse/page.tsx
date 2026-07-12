"use client";
/**
 * Browse — live Chromium + Sora side panel.
 * Sessions are created on first navigation (not on mount) so dev remounts
 * don't kill the browser instantly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Card, Input, Badge, EmptyState } from "@/components/ui";
import { BrowseSoraPanel, SESSION_KEY } from "@/components/browse/sora-panel";
import { AppBrowser, getLmBrowser } from "@/components/browse/app-browser";
import {
  Globe, ShieldAlert, Loader2, ArrowLeft, ArrowRight, RotateCw, BookOpen, MousePointer2,
} from "lucide-react";

type Snapshot = {
  sessionId: string;
  url: string;
  title: string;
  screenshotBase64: string;
  viewport: { width: number; height: number };
};

type Mode = "live" | "reader";

export default function BrowsePage() {
  // Inside the Electron shell, /browse IS the browser: real Chromium tabs
  // via window.lmBrowser (preload). On the web build, fall back to the
  // screenshot Live mode + Reader. Detected post-mount to avoid hydration
  // mismatch (SSR can't see window.lmBrowser).
  const [shell, setShell] = useState<"detecting" | "app" | "web">("detecting");
  useEffect(() => { setShell(getLmBrowser() ? "app" : "web"); }, []);
  if (shell === "detecting") return null;
  if (shell === "app") return <AppBrowser />;
  return <WebBrowsePage />;
}

function WebBrowsePage() {
  const [mode, setMode] = useState<Mode>("live");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readerMd, setReaderMd] = useState<string | null>(null);
  const [typeText, setTypeText] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);

  const persistSession = useCallback((id: string) => {
    setSessionId(id);
    try { sessionStorage.setItem(SESSION_KEY, id); } catch {}
  }, []);

  const applySnap = useCallback((snap: Snapshot) => {
    persistSession(snap.sessionId);
    setSnapshot(snap);
    if (snap.url && snap.url !== "about:blank") setUrl(snap.url);
    setError(null);
  }, [persistSession]);

  const refresh = useCallback(async (sid: string) => {
    const r = await fetch(`/api/browse/session/${sid}`);
    if (r.ok) {
      applySnap(await r.json());
      return true;
    }
    if (r.status === 404) {
      try { sessionStorage.removeItem(SESSION_KEY); } catch {}
      setSessionId(null);
    }
    return false;
  }, [applySnap]);

  // Restore a previous session if the server still has it (no create-on-mount).
  useEffect(() => {
    if (mode !== "live") return;
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(SESSION_KEY); } catch {}
    if (stored) refresh(stored);
  }, [mode, refresh]);

  async function liveNavigate(raw?: string) {
    let u = (raw ?? url).trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setLoading(true);
    setError(null);
    try {
      const sid = sessionId || "new";
      const r = await fetch(`/api/browse/session/${sid}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Navigation failed.");
        if (j.sessionId) persistSession(j.sessionId);
        return;
      }
      applySnap(j);
    } catch {
      setError("Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function readerGo(raw?: string) {
    let u = (raw ?? url).trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setLoading(true);
    setReaderMd(null);
    setError(null);
    try {
      const r = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const j = await r.json();
      if (r.ok) setReaderMd(j.markdown);
      else setError(j.error || "Reader failed.");
    } finally {
      setLoading(false);
    }
  }

  function open() {
    if (mode === "live") liveNavigate();
    else readerGo();
  }

  async function act(action: Record<string, unknown>) {
    if (!sessionId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/browse/session/${sessionId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const j = await r.json();
      if (r.ok) applySnap(j);
      else setError(j.error || "Action failed.");
    } finally {
      setLoading(false);
    }
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!snapshot || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * snapshot.viewport.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * snapshot.viewport.height);
    act({ type: "click", x, y });
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-0px)] min-h-[500px] max-w-[100vw]">
      <div className="flex-1 min-w-0 flex flex-col px-4 md:px-6 py-4 overflow-hidden">
        <div className="shrink-0 mb-3">
          <p className="lm-micro mb-1">Browse</p>
          <h1 className="lm-display text-xl">Browse with Sora</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
            <button type="button" onClick={() => setMode("live")}
              className={`px-3 py-1.5 flex items-center gap-1 ${mode === "live" ? "bg-white/15" : "text-white/60"}`}>
              <MousePointer2 className="h-3 w-3" /> Live
            </button>
            <button type="button" onClick={() => setMode("reader")}
              className={`px-3 py-1.5 flex items-center gap-1 ${mode === "reader" ? "bg-white/15" : "text-white/60"}`}>
              <BookOpen className="h-3 w-3" /> Reader
            </button>
          </div>
          {mode === "live" && sessionId && (
            <>
              <Button size="sm" variant="outline" onClick={() => act({ type: "back" })} disabled={loading}><ArrowLeft className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => act({ type: "forward" })} disabled={loading}><ArrowRight className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => liveNavigate(url)} disabled={loading || !url}><RotateCw className="h-3.5 w-3.5" /></Button>
            </>
          )}
          <Input className="flex-1 min-w-[140px]" placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") open(); }} />
          <Button onClick={open} disabled={loading || !url.trim()} className="shrink-0 gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            Go
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && (
            <Card className="p-3 mb-3 border-destructive/40 flex gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </Card>
          )}

          {mode === "live" && !snapshot && !loading && (
            <EmptyState title="Enter a URL and press Go" hint="Live mode runs Chromium with JavaScript — click the page to interact, or ask Sora on the right." />
          )}

          {mode === "live" && snapshot?.screenshotBase64 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="success">live</Badge>
                <span className="text-xs text-muted-foreground truncate">{snapshot.url}</span>
              </div>
              <Card className="p-1 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} src={`data:image/jpeg;base64,${snapshot.screenshotBase64}`} alt="Page"
                  className="w-full cursor-crosshair" onClick={onImageClick} />
              </Card>
              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Type here (click page first to focus)…" value={typeText}
                  onChange={(e) => setTypeText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { act({ type: "type", text: typeText }); setTypeText(""); } }} />
                <Button variant="outline" onClick={() => { act({ type: "type", text: typeText }); setTypeText(""); }}>Type</Button>
                <Button variant="outline" onClick={() => act({ type: "press", key: "Enter" })}>Enter</Button>
              </div>
            </div>
          )}

          {mode === "reader" && readerMd && (
            <Card className="p-6">
              <article className="prose prose-sm dark:prose-invert max-w-none [&_a]:break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{readerMd}</ReactMarkdown>
              </article>
            </Card>
          )}
          {mode === "reader" && !readerMd && !loading && (
            <EmptyState title="Reader mode" hint="Sanitized text only — switch to Live for forms and JS." />
          )}
        </div>
      </div>

      <div className="w-full lg:w-[min(400px,36vw)] shrink-0 flex flex-col max-h-[40vh] lg:max-h-none">
        <BrowseSoraPanel browseSessionId={mode === "live" ? sessionId : null}
          onBrowseAction={() => sessionId && refresh(sessionId)} />
      </div>
    </div>
  );
}
