"use client";
import { useEffect, useState } from "react";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { CURATED_MODELS } from "@/lib/curated-models";
import { Download, Trash2, Check, ExternalLink } from "lucide-react";

type Model = { name: string; family?: string; size?: number; modified?: string; path?: string };
type HfCatalogueEntry = {
  repo: string;
  file: string;
  ollamaName: string;
  description: string;
  ram: string;
  size: string;
};
type Provider = "ollama" | "huggingface" | "lmstudio";

const PROVIDER_TABS: { id: Provider; label: string; blurb: string }[] = [
  { id: "ollama",      label: "Ollama",        blurb: "Native Ollama models, downloaded and run by the Ollama daemon." },
  { id: "huggingface", label: "Hugging Face",  blurb: "Download GGUF quant files directly from the Hub. Optionally auto-registers with Ollama so chat works without extra setup." },
  { id: "lmstudio",    label: "LM Studio",     blurb: "Discover models loaded in a running LM Studio server. Downloads happen in the LM Studio app itself." },
];

function fmtSize(n?: number) {
  if (!n) return "—";
  return (n / 1e9).toFixed(1) + " GB";
}

export default function ModelsPage() {
  const [provider, setProvider] = useState<Provider>("ollama");
  const [models, setModels] = useState<Model[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<HfCatalogueEntry[]>([]);
  const [pulling, setPulling] = useState<{ label: string; pct: number; status: string; bytes?: number; total?: number } | null>(null);

  async function load(p: Provider = provider) {
    const r = await fetch(`/api/models?provider=${p}`);
    const j = await r.json();
    setModels(j.models || []);
    setActive(j.active || null);
    setErr(j.error || null);
    setDocsUrl(j.docs_url || null);
    setCatalogue(j.catalogue || []);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(provider); }, [provider]);

  async function setActiveModel(name: string) {
    const r = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        active_model: name,
        // Selecting a model from the LM Studio tab must also switch the chat provider.
        ...(provider === "lmstudio" ? { provider: "lmstudio" } : {}),
        ...(provider === "ollama" ? { provider: "ollama" } : {}),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `Could not set active model (HTTP ${r.status})`);
      return;
    }
    setActive(name);
  }

  async function del(name: string) {
    if (provider !== "ollama") {
      // HF files live on disk; LM Studio owns its own state. We'd want a
      // dedicated delete API per provider; for now keep delete Ollama-only
      // and tell the user where to manage the others.
      alert(
        provider === "huggingface"
          ? "Delete Hugging Face files from ~/.localmind/models/huggingface for now."
          : "Manage LM Studio models from the LM Studio app."
      );
      return;
    }
    if (!confirm(`Delete ${name}? This frees ${fmtSize(models.find((m) => m.name === name)?.size)} of disk.`)) return;
    const r = await fetch(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `Delete failed (HTTP ${r.status})`);
      return;
    }
    load();
  }

  async function streamPull(label: string, body: Record<string, unknown>) {
    setPulling({ label, pct: 0, status: "starting" });
    try {
      const res = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || `Pull failed (HTTP ${res.status})`);
        setPulling(null);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const c of chunks) {
          const line = c.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const o = JSON.parse(line.slice(6));
          if (o.type === "progress") setPulling({ label, pct: o.pct, status: o.status, bytes: o.bytes, total: o.total });
          if (o.type === "done") { finished = true; setPulling(null); load(); }
          if (o.type === "error") { finished = true; setErr(o.message); setPulling(null); }
        }
      }
      if (!finished) setPulling(null);
    } catch (e: any) {
      setErr(e?.message || "Pull failed");
      setPulling(null);
    }
  }

  function pullOllama(name: string)        { streamPull(name, { provider: "ollama", name }); }
  function pullHuggingface(c: HfCatalogueEntry) {
    streamPull(`${c.repo}/${c.file}`, {
      provider: "huggingface",
      repo: c.repo,
      file: c.file,
      ollamaName: c.ollamaName,
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-14">
      <div className="mb-8">
        <p className="lm-micro mb-2">Models</p>
        <h1 className="lm-display">Local minds</h1>
      </div>

      <div className="flex gap-2 mb-3">
        {PROVIDER_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setProvider(t.id)}
            className={`rounded-full px-3 py-1 text-sm border ${provider === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        {PROVIDER_TABS.find((t) => t.id === provider)?.blurb}
      </p>

      {err && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
          <span className="flex-1">{err}</span>
          {docsUrl && (
            <a className="underline inline-flex items-center gap-1" href={docsUrl} target="_blank" rel="noreferrer">
              docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {pulling && (
        <Card className="p-4 mb-4">
          <p className="text-sm font-medium">Downloading {pulling.label}</p>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pulling.pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {pulling.pct}% — {pulling.status}
            {pulling.bytes && pulling.total
              ? ` · ${(pulling.bytes / 1e9).toFixed(2)} / ${(pulling.total / 1e9).toFixed(2)} GB`
              : ""}
          </p>
        </Card>
      )}

      <h2 className="text-sm font-medium mb-2">Installed</h2>
      {models.length === 0 ? (
        <EmptyState
          title="Nothing installed in this provider yet"
          hint={
            provider === "ollama"      ? "Pick a model from the catalogue below — llama3.2 is a good first choice." :
            provider === "huggingface" ? "Download a GGUF from the curated list below; it'll auto-register with Ollama if you have it." :
                                          "Open LM Studio and download a model from its Models tab, then refresh."
          }
        />
      ) : (
        <div className="space-y-2 mb-6">
          {models.map((m) => (
            <Card key={m.name} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{m.name}</span>
                  {active === m.name && <Badge variant="success">Active</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {m.family || "model"} · {fmtSize(m.size)}
                  {m.path ? <> · <code className="text-[10px]">{m.path}</code></> : null}
                </p>
              </div>
              {active !== m.name && (
                <Button size="sm" variant="outline" onClick={() => setActiveModel(m.name)}>
                  <Check className="h-3.5 w-3.5" /> Set active
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => del(m.name)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {provider === "ollama" && (
        <>
          <h2 className="text-sm font-medium mb-2">Pull a new Ollama model</h2>
          <div className="flex gap-2 mb-3">
            <input
              id="custom-model"
              placeholder="Any Ollama model name, e.g. gemma2:9b"
              className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button size="sm" disabled={!!pulling} onClick={() => {
              const v = (document.getElementById("custom-model") as HTMLInputElement)?.value.trim();
              if (v) pullOllama(v);
            }}>
              <Download className="h-3.5 w-3.5" /> Pull
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {CURATED_MODELS.map((m) => {
              const installed = models.some((x) => x.name === m.name);
              return (
                <Card key={m.name} className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Min RAM {m.ram} · {m.size}</p>
                    </div>
                    <Button size="sm" disabled={installed || !!pulling} onClick={() => pullOllama(m.name)}>
                      <Download className="h-3.5 w-3.5" />
                      {installed ? "Installed" : "Download"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {provider === "huggingface" && (
        <>
          <h2 className="text-sm font-medium mb-2">Download from the Hub</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Files are streamed to <code>~/.localmind/models/huggingface/</code>. If Ollama is installed, each download is registered under the suggested name so you can switch to it from the Active picker.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalogue.map((c) => {
              const installed = models.some((m) => m.name.endsWith(`/${c.file}`));
              return (
                <Card key={`${c.repo}/${c.file}`} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{c.repo}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.file}</p>
                      <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Min RAM {c.ram} · {c.size} · Ollama name: <code>{c.ollamaName}</code></p>
                    </div>
                    <Button size="sm" disabled={installed || !!pulling} onClick={() => pullHuggingface(c)}>
                      <Download className="h-3.5 w-3.5" />
                      {installed ? "Downloaded" : "Download"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-4">
            Want a different repo? <a className="underline" href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer">Browse the GGUF library</a>, then add a curated entry under <code>HUGGINGFACE_CURATED</code> in <code>src/lib/providers/huggingface.ts</code>.
          </p>
        </>
      )}

      {provider === "lmstudio" && (
        <>
          <h2 className="text-sm font-medium mb-2">LM Studio</h2>
          <p className="text-xs text-muted-foreground">
            LM Studio manages its own downloads from inside the desktop app. Open LM Studio → Models → search for a model → Download. Once it's loaded and the local server is running, models show up in the Installed list above.
          </p>
          {docsUrl && (
            <a className="text-xs underline inline-flex items-center gap-1 mt-2" href={docsUrl} target="_blank" rel="noreferrer">
              LM Studio local server docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}
    </div>
  );
}
