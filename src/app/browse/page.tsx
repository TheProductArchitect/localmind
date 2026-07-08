"use client";
/**
 * Browse — the agentic-browser surface, LocalMind style.
 *
 * Not a Chromium embed. Every page is fetched through the same Secure
 * Browser pipeline agents use (sanitize → injection scan → web-guard), so
 * what you see here is exactly what Sora would see — and everything the
 * guard blocks for agents is blocked here too. Reader-mode by construction:
 * no scripts, no trackers, no ads, no hidden text.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Card, Input, Badge, EmptyState } from "@/components/ui";
import { Globe, ShieldAlert, Sparkles, Loader2 } from "lucide-react";

export default function BrowsePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; blocked: boolean; markdown: string } | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  async function go(raw?: string) {
    let u = (raw ?? url).trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const j = await r.json();
      if (r.ok) {
        setResult(j);
        setCurrentUrl(u);
      } else {
        setResult({ ok: false, blocked: false, markdown: j.error || "Request failed." });
      }
    } finally {
      setLoading(false);
    }
  }

  function askSora() {
    if (!currentUrl) return;
    const prompt = `Read ${currentUrl} and `;
    router.push(`/?new=1&ask=${encodeURIComponent(prompt)}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-10 py-14">
      <div className="mb-10">
        <p className="lm-micro mb-2">Browse</p>
        <h1 className="lm-display">The web, through the guard</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Pages load through the Secure Browser — sanitized, injection-scanned, no scripts or trackers.
          What you see is exactly what Sora sees.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <Input
          placeholder="example.com or a full URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        />
        <Button onClick={() => go()} disabled={loading || !url.trim()} className="inline-flex items-center gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
          Open
        </Button>
      </div>

      {loading && (
        <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Fetching and sanitizing…
        </Card>
      )}

      {!loading && !result && (
        <EmptyState
          title="Nothing open yet"
          hint="Enter a URL above. Sensitive sites (banking, government, webmail) are blind by default — manage exceptions in Settings → Web access."
        />
      )}

      {!loading && result && result.blocked && (
        <Card className="p-4 border-destructive/40">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive mb-1">Blocked by the guard</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{result.markdown}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && result && !result.blocked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="success">sanitized</Badge>
            <span className="text-xs text-muted-foreground truncate flex-1">{currentUrl}</span>
            <Button size="sm" variant="outline" onClick={askSora} className="inline-flex items-center gap-1.5 shrink-0">
              <Sparkles className="h-3.5 w-3.5" /> Ask Sora about this page
            </Button>
          </div>
          <Card className="p-6">
            <article className="prose prose-sm dark:prose-invert max-w-none [&_a]:break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.markdown}</ReactMarkdown>
            </article>
          </Card>
        </div>
      )}
    </div>
  );
}
