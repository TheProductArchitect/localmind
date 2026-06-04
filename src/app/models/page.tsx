"use client";
import { useEffect, useState } from "react";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { CURATED_MODELS } from "@/lib/curated-models";
import { Download, Trash2, Check } from "lucide-react";

type Model = { name: string; family?: string; size?: number; modified?: string };

function fmtSize(n?: number) {
  if (!n) return "—";
  return (n / 1e9).toFixed(1) + " GB";
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pulling, setPulling] = useState<{ name: string; pct: number; status: string } | null>(null);

  async function load() {
    const r = await fetch("/api/models");
    const j = await r.json();
    setModels(j.models || []);
    setActive(j.active || null);
    setErr(j.error || null);
  }
  useEffect(() => { load(); }, []);

  async function setActiveModel(name: string) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active_model: name }),
    });
    setActive(name);
  }

  async function del(name: string) {
    if (!confirm(`Delete ${name}? This frees ${fmtSize(models.find((m) => m.name === name)?.size)} of disk.`)) return;
    await fetch(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
  }

  async function pull(name: string) {
    setPulling({ name, pct: 0, status: "starting" });
    const res = await fetch("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
        if (o.type === "progress") setPulling({ name, pct: o.pct, status: o.status });
        if (o.type === "done") { setPulling(null); load(); }
        if (o.type === "error") { setErr(o.message); setPulling(null); }
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-14">
      <div className="mb-10">
        <p className="lm-micro mb-2">Models</p>
        <h1 className="lm-display">Local minds</h1>
      </div>
      {err && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      {pulling && (
        <Card className="p-4 mb-4">
          <p className="text-sm font-medium">Downloading {pulling.name}</p>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pulling.pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{pulling.pct}% — {pulling.status}</p>
        </Card>
      )}

      <h2 className="text-sm font-medium mb-2">Installed models</h2>
      {models.length === 0 ? (
        <EmptyState
          title="You have not pulled any models yet"
          hint="A good place to start is llama3.2 — it runs well on most Macs. Pick one below."
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
                <p className="text-xs text-muted-foreground">{m.family || "model"} · {fmtSize(m.size)}</p>
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

      <h2 className="text-sm font-medium mb-2">Pull a new model</h2>
      <div className="flex gap-2 mb-3">
        <input
          id="custom-model"
          placeholder="Any Ollama model name, e.g. gemma2:9b"
          className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button size="sm" disabled={!!pulling} onClick={() => {
          const v = (document.getElementById("custom-model") as HTMLInputElement)?.value.trim();
          if (v) pull(v);
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
                <Button
                  size="sm"
                  disabled={installed || !!pulling}
                  onClick={() => pull(m.name)}
                >
                  <Download className="h-3.5 w-3.5" />
                  {installed ? "Installed" : "Download"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
