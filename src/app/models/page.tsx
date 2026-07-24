"use client";
import { useEffect, useState } from "react";
import { Button, Badge, EmptyState } from "@/components/ui";
import { PageHeader, PageShell } from "@/components/page-header";
import { useConfirm } from "@/components/confirm-dialog";
import { CURATED_MODELS } from "@/lib/curated-models";
import { Download, Trash2, Check, ExternalLink } from "lucide-react";
import { toast } from "@/components/toast";

type Model = { name: string; family?: string; size?: number; modified?: string; path?: string };
type HfCatalogueEntry = {
  repo: string;
  file: string;
  ollamaName: string;
  description: string;
  ram: string;
  size: string;
};
type Provider =
  | "ollama"
  | "huggingface"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "groq"
  | "openrouter"
  | "gemini"
  | "mindstudio";

const LOCAL_TABS: { id: Provider; label: string; blurb: string }[] = [
  { id: "ollama", label: "Ollama", blurb: "Native Ollama models, downloaded and run by the Ollama daemon." },
  { id: "huggingface", label: "Hugging Face", blurb: "Download GGUF quant files from the Hub. Optionally auto-registers with Ollama." },
  { id: "lmstudio", label: "LM Studio", blurb: "Discover models loaded in a running LM Studio server." },
];

const CLOUD_TABS: { id: Provider; label: string; blurb: string }[] = [
  { id: "anthropic", label: "Anthropic", blurb: "Claude models via your Anthropic API key (Settings → Providers)." },
  { id: "openai", label: "OpenAI", blurb: "GPT models via your OpenAI API key." },
  { id: "gemini", label: "Gemini", blurb: "Google Gemini models via a Google AI Studio API key." },
  { id: "groq", label: "Groq", blurb: "Fast inference via Groq." },
  { id: "openrouter", label: "OpenRouter", blurb: "Many frontier labs through one OpenRouter key." },
  {
    id: "mindstudio",
    label: "Cloud — MindStudio",
    blurb: "Opt-in cloud router. Never the default. Requires an API key; set MINDSTUDIO_BASE_URL if your gateway differs from the documented placeholder.",
  },
];

const PROVIDER_TABS = [...LOCAL_TABS, ...CLOUD_TABS];
const CLOUD_IDS = new Set(CLOUD_TABS.map((t) => t.id));

function fmtSize(n?: number) {
  if (!n) return "—";
  return (n / 1e9).toFixed(1) + " GB";
}

/** Chat provider to set when activating a model from this tab. */
function chatProviderForTab(tab: Provider): string | null {
  if (tab === "huggingface") return "ollama";
  if (tab === "ollama" || tab === "lmstudio") return tab;
  if (CLOUD_IDS.has(tab)) return tab;
  return null;
}

export default function ModelsPage() {
  const confirm = useConfirm();
  const [provider, setProvider] = useState<Provider>("ollama");
  const [models, setModels] = useState<Model[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<HfCatalogueEntry[]>([]);
  const [needsKey, setNeedsKey] = useState(false);
  const [pulling, setPulling] = useState<{ label: string; pct: number; status: string; bytes?: number; total?: number } | null>(null);

  async function load(p: Provider = provider) {
    const r = await fetch(`/api/models?provider=${p}`);
    const j = await r.json();
    setModels(j.models || []);
    setActive(j.active || null);
    setActiveProvider(j.active_provider || null);
    setErr(j.error || null);
    setDocsUrl(j.docs_url || null);
    setCatalogue(j.catalogue || []);
    setNeedsKey(!!j.needs_key);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(provider); }, [provider]);

  async function setActiveModel(name: string) {
    const chatProvider = chatProviderForTab(provider);
    const r = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        active_model: name,
        ...(chatProvider ? { provider: chatProvider } : {}),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `Could not set active model (HTTP ${r.status})`);
      return;
    }
    setActive(name);
    if (chatProvider) setActiveProvider(chatProvider);
  }

  function isActive(name: string) {
    const chatProvider = chatProviderForTab(provider);
    if (chatProvider && activeProvider && chatProvider !== activeProvider) return false;
    return active === name;
  }

  async function del(name: string) {
    if (provider !== "ollama") {
      toast(
        provider === "huggingface"
          ? "Delete Hugging Face files from ~/.localmind/models/huggingface for now."
          : CLOUD_IDS.has(provider)
            ? "Cloud models are listed from the provider API — nothing to delete locally."
            : "Manage LM Studio models from the LM Studio app.",
        "info"
      );
      return;
    }
    const ok = await confirm({
      title: `Delete ${name}?`,
      message: `This frees ${fmtSize(models.find((m) => m.name === name)?.size)} of disk.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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

  function pullOllama(name: string) { streamPull(name, { provider: "ollama", name }); }
  function pullHuggingface(c: HfCatalogueEntry) {
    streamPull(`${c.repo}/${c.file}`, {
      provider: "huggingface",
      repo: c.repo,
      file: c.file,
      ollamaName: c.ollamaName,
    });
  }

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Models"
        title="Models"
        hint={
          <>
            Local runtimes and frontier labs. Activating a model sets provider and model together.
            {active && activeProvider ? (
              <> Current default: <code>{activeProvider}</code> / <code>{active}</code>.</>
            ) : null}
          </>
        }
      />

      <p className="lm-micro mb-2">Local</p>
      <div className="lm-tabs mb-4" role="tablist" aria-label="Local providers">
        {LOCAL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={provider === t.id}
            onClick={() => setProvider(t.id)}
            className={`lm-tab ${provider === t.id ? "is-active" : ""}`}
            data-pulse="true"
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="lm-micro mb-2">Cloud / frontier</p>
      <div className="lm-tabs mb-3" role="tablist" aria-label="Cloud providers">
        {CLOUD_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={provider === t.id}
            onClick={() => setProvider(t.id)}
            className={`lm-tab ${provider === t.id ? "is-active" : ""}`}
            data-pulse="true"
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="lm-body mb-6" style={{ color: "hsl(0 0% 100% / 0.5)", fontSize: "0.8125rem" }}>
        {PROVIDER_TABS.find((t) => t.id === provider)?.blurb}
      </p>

      {err && (
        <div className="lm-panel mb-4 flex items-start gap-2 text-sm" style={{ borderColor: "hsl(0 90% 64% / 0.35)" }}>
          <span className="flex-1" style={{ color: "hsl(0 100% 78%)" }}>{err}</span>
          {needsKey && (
            <a className="underline shrink-0" href="/settings">Settings → Providers</a>
          )}
          {docsUrl && (
            <a className="underline inline-flex items-center gap-1" href={docsUrl} target="_blank" rel="noreferrer">
              docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {pulling && (
        <div className="lm-panel mb-4">
          <p className="text-sm font-medium">Downloading {pulling.label}</p>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(0 0% 100% / 0.08)" }}>
            <div className="h-full transition-all" style={{ width: `${pulling.pct}%`, background: "hsl(0 0% 100%)" }} />
          </div>
          <p className="text-xs mt-1" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
            {pulling.pct}% — {pulling.status}
            {pulling.bytes && pulling.total
              ? ` · ${(pulling.bytes / 1e9).toFixed(2)} / ${(pulling.total / 1e9).toFixed(2)} GB`
              : ""}
          </p>
        </div>
      )}

      <h2 className="lm-micro mb-2">
        {CLOUD_IDS.has(provider) ? "Available" : "Installed"}
      </h2>
      {models.length === 0 ? (
        <EmptyState
          showOrb={needsKey || provider === "ollama"}
          title={needsKey ? "API key required" : "Nothing available in this provider yet"}
          hint={
            needsKey ? "Save a key under Settings → Providers, then refresh this tab." :
            provider === "ollama" ? "Pick a model from the catalogue below — llama3.2 is a good first choice." :
            provider === "huggingface" ? "Download a GGUF from the curated list below; it'll auto-register with Ollama if you have it." :
            provider === "lmstudio" ? "Open LM Studio and download a model from its Models tab, then refresh." :
            "Check your API key and network, then refresh."
          }
          action={needsKey ? <a href="/settings" className="lm-action">Open Settings</a> : undefined}
        />
      ) : (
        <div className="space-y-2 mb-6">
          {models.map((m) => (
            <div key={m.name} className="lm-panel flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{m.name}</span>
                  {isActive(m.name) && <Badge variant="success">Active</Badge>}
                </div>
                <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
                  {m.family || "model"} · {fmtSize(m.size)}
                  {m.path ? <> · <code className="text-[10px]">{m.path}</code></> : null}
                </p>
              </div>
              {!isActive(m.name) && (
                <Button size="sm" variant="outline" onClick={() => setActiveModel(m.name)}>
                  <Check className="h-3.5 w-3.5" /> Set active
                </Button>
              )}
              {!CLOUD_IDS.has(provider) && (
                <Button size="sm" variant="ghost" onClick={() => del(m.name)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {provider === "ollama" && (
        <>
          <h2 className="lm-micro mb-2">Pull a new Ollama model</h2>
          <div className="flex gap-2 mb-3">
            <input
              id="custom-model"
              placeholder="Any Ollama model name, e.g. gemma2:9b"
              className="lm-input flex-1"
            />
            <button type="button" className="lm-action" disabled={!!pulling} data-pulse="true" onClick={() => {
              const v = (document.getElementById("custom-model") as HTMLInputElement)?.value.trim();
              if (v) pullOllama(v);
            }}>
              <Download className="h-3.5 w-3.5" /> Pull
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {CURATED_MODELS.map((m) => {
              const installed = models.some((x) => x.name === m.name);
              return (
                <div key={m.name} className="lm-panel">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{m.name}</p>
                      <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{m.description}</p>
                      <p className="text-xs mt-1" style={{ color: "hsl(0 0% 100% / 0.45)" }}>Min RAM {m.ram} · {m.size}</p>
                    </div>
                    <Button size="sm" disabled={installed || !!pulling} onClick={() => pullOllama(m.name)}>
                      <Download className="h-3.5 w-3.5" />
                      {installed ? "Installed" : "Download"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {provider === "huggingface" && (
        <>
          <h2 className="lm-micro mb-2">Download from the Hub</h2>
          <p className="text-xs mb-3" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
            Files land in <code>~/.localmind/models/huggingface/</code>. If Ollama is installed, each download can register under the suggested name.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalogue.map((c) => {
              const installed = models.some((m) => m.name.endsWith(`/${c.file}`));
              return (
                <div key={`${c.repo}/${c.file}`} className="lm-panel">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{c.repo}</p>
                      <p className="text-[11px] truncate" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{c.file}</p>
                      <p className="text-xs mt-1" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{c.description}</p>
                      <p className="text-xs mt-1" style={{ color: "hsl(0 0% 100% / 0.45)" }}>Min RAM {c.ram} · {c.size} · Ollama: <code>{c.ollamaName}</code></p>
                    </div>
                    <Button size="sm" disabled={installed || !!pulling} onClick={() => pullHuggingface(c)}>
                      <Download className="h-3.5 w-3.5" />
                      {installed ? "Downloaded" : "Download"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {provider === "lmstudio" && (
        <>
          <h2 className="lm-micro mb-2">LM Studio</h2>
          <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
            Downloads happen inside the LM Studio app. Once a model is loaded and the local server is running, it shows up above.
          </p>
          {docsUrl && (
            <a className="text-xs underline inline-flex items-center gap-1 mt-2" href={docsUrl} target="_blank" rel="noreferrer">
              LM Studio local server docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}
    </PageShell>
  );
}
