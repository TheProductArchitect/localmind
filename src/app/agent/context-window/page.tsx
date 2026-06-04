"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { Gauge, Save, RotateCcw } from "lucide-react";

type Persona = { persona_id: string; name: string };

type ContextSettings = {
  compression_threshold_pct: number;
  compression_target_pct: number;
  compression_strategy: "summarise" | "truncate" | "sliding_window";
  summarisation_model: string | null;
  tool_result_max_chars: number;
  per_conversation_override_enabled: number;
};

type Override = { model_name: string; context_window_tokens: number; source: string };
type Model = { name: string; family?: string; size?: number };

const KNOWN_DEFAULTS: Record<string, number> = {
  // Mirror of src/lib/db/model-context-overrides.ts KNOWN — used so the table
  // can show a sensible source ("known") for installed models the user hasn't
  // overridden, without needing a separate API roundtrip.
  "llama3.2": 131072, "llama3.2:1b": 131072, "llama3.2:3b": 131072,
  "llama3.1": 131072, "llama3.1:8b": 131072, "llama3.1:70b": 131072,
  "qwen2.5": 32768, "qwen2.5:7b": 32768, "qwen2.5:14b": 32768, "qwen2.5-coder": 32768,
  "gemma2": 8192, "gemma2:9b": 8192, "gemma2:27b": 8192,
  "mistral": 32768, "mistral:7b": 32768,
  "phi3": 4096, "phi3.5": 131072,
  "codellama": 16384,
  "deepseek-r1": 65536, "deepseek-r1:7b": 65536, "deepseek-r1:14b": 65536,
};

function resolveFromKnown(modelName: string): number | null {
  if (KNOWN_DEFAULTS[modelName]) return KNOWN_DEFAULTS[modelName];
  const bare = modelName.split(":")[0];
  return KNOWN_DEFAULTS[bare] ?? null;
}

export default function ContextWindowPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState<string>("persona-general");
  const [settings, setSettings] = useState<ContextSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [preview, setPreview] = useState<{ assembled: string; tokenEstimate: number } | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Load personas + settings once.
  useEffect(() => {
    fetch("/api/agent/personas").then((r) => r.json()).then((j) => setPersonas(j.personas || []));
    fetch("/api/agent/context-settings").then((r) => r.json()).then((j) => setSettings(j.settings));
  }, []);

  // Reload preview when persona changes.
  useEffect(() => {
    if (!personaId) return;
    fetch(`/api/agent/system-prompt/${personaId}?preview=1`)
      .then((r) => r.json())
      .then((j) => setPreview({ assembled: j.assembled || "", tokenEstimate: j.tokenEstimate || 0 }))
      .catch(() => setPreview(null));
  }, [personaId]);

  const loadModels = useCallback(async () => {
    const [mj, oj] = await Promise.all([
      fetch("/api/models").then((r) => r.json()),
      fetch("/api/agent/model-context-overrides").then((r) => r.json()),
    ]);
    setModels(mj.models || []);
    setActiveModel(mj.active || null);
    setOverrides(oj.overrides || []);
  }, []);
  useEffect(() => { loadModels(); }, [loadModels]);

  // Effective context window for the active model — used by the visualiser.
  const effectiveCtx = useMemo(() => {
    if (!activeModel) return { tokens: 4096, source: "estimated" as const };
    const override = overrides.find((o) => o.model_name === activeModel);
    if (override) return { tokens: override.context_window_tokens, source: "user-override" as const };
    const known = resolveFromKnown(activeModel);
    if (known) return { tokens: known, source: "hardcoded" as const };
    return { tokens: 4096, source: "estimated" as const };
  }, [activeModel, overrides]);

  // Token allocation estimate: blue = system prompt, green = recent history,
  // amber = tool results (best-effort, not measured).
  const allocation = useMemo(() => {
    const total = effectiveCtx.tokens;
    const sys = preview?.tokenEstimate ?? 0;
    const hist = Math.min(Math.round(total * 0.4), 2000); // placeholder
    const tools = Math.min(Math.round(total * 0.1), 1000);
    const used = sys + hist + tools;
    return { total, sys, hist, tools, free: Math.max(0, total - used), used };
  }, [effectiveCtx, preview]);

  async function saveSettings(patch: Partial<ContextSettings>) {
    setSavingSettings(true);
    try {
      const r = await fetch("/api/agent/context-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Save failed", "error"); return; }
      setSettings(j.settings);
      toast("Saved", "success");
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveOverride(modelName: string, raw: string) {
    const tokens = Math.floor(Number(raw));
    if (!Number.isFinite(tokens) || tokens < 512) {
      toast("Enter a token count of at least 512.", "error");
      return;
    }
    const r = await fetch(`/api/agent/model-context-overrides/${encodeURIComponent(modelName)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_window_tokens: tokens }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Could not save override", "error");
      return;
    }
    setEditingModel(null);
    loadModels();
    toast(`Override saved for ${modelName}`, "success");
  }

  async function clearOverride(modelName: string) {
    await fetch(`/api/agent/model-context-overrides/${encodeURIComponent(modelName)}`, { method: "DELETE" });
    loadModels();
  }

  function sourceLabel(modelName: string): { label: string; tone: "outline" | "success" | "warning" } {
    const override = overrides.find((o) => o.model_name === modelName);
    if (override) return { label: "user override", tone: "success" };
    if (resolveFromKnown(modelName)) return { label: "known", tone: "outline" };
    return { label: "estimated", tone: "warning" };
  }

  function effectiveTokens(modelName: string): number {
    const override = overrides.find((o) => o.model_name === modelName);
    if (override) return override.context_window_tokens;
    return resolveFromKnown(modelName) ?? 4096;
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-14 space-y-6">
      <div className="mb-2">
        <p className="lm-micro mb-2">Agent · context</p>
        <h1 className="lm-display">How much Sora can hold</h1>
      </div>

      {/* Persona selector */}
      <Card className="p-3">
        <label className="block text-sm">
          Persona
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {personas.map((p) => (
              <option key={p.persona_id} value={p.persona_id}>{p.name}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground mt-2">
          Per-persona compression overrides land in a follow-up — the bar below uses the global
          settings and the system prompt assembled for this persona.
        </p>
      </Card>

      {/* Visualiser */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-medium flex-1">Context allocation</p>
          <span className="text-xs text-muted-foreground">
            {activeModel || "(no active model)"} · {effectiveCtx.tokens.toLocaleString()} tokens
          </span>
          <Badge variant="outline">{effectiveCtx.source}</Badge>
        </div>

        <div className="flex h-3 rounded-full overflow-hidden border bg-muted" role="img" aria-label="Context window allocation">
          <div
            className="h-full bg-blue-500"
            style={{ width: `${pct(allocation.sys, allocation.total)}%` }}
            title={`System prompt: ${allocation.sys.toLocaleString()} tokens`}
          />
          <div
            className="h-full bg-green-500"
            style={{ width: `${pct(allocation.hist, allocation.total)}%` }}
            title={`Conversation history (estimate): ${allocation.hist.toLocaleString()} tokens`}
          />
          <div
            className="h-full bg-amber-500"
            style={{ width: `${pct(allocation.tools, allocation.total)}%` }}
            title={`Tool results (estimate): ${allocation.tools.toLocaleString()} tokens`}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
          <Legend color="bg-blue-500" label="System prompt" value={allocation.sys} />
          <Legend color="bg-green-500" label="History (est.)" value={allocation.hist} />
          <Legend color="bg-amber-500" label="Tool results (est.)" value={allocation.tools} />
          <Legend color="bg-muted-foreground/40" label="Free" value={allocation.free} />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {pct(allocation.used, allocation.total)}% used. History and tool-result estimates use
          rough heuristics — exact measurement lands when the per-conversation override panel is wired.
        </p>
      </Card>

      {/* Compression settings */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium">Compression</p>
        {!settings ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <SliderRow
              label="Trigger threshold"
              hint="When this much of the context window is used, compression runs."
              value={settings.compression_threshold_pct}
              min={50} max={95} step={1} suffix="%"
              onChange={(v) => setSettings({ ...settings, compression_threshold_pct: v })}
            />
            <SliderRow
              label="Target after compression"
              hint="History is compressed down to this share of the window."
              value={settings.compression_target_pct}
              min={20} max={80} step={1} suffix="%"
              onChange={(v) => setSettings({ ...settings, compression_target_pct: v })}
            />

            <label className="block text-sm">
              Strategy
              <select
                value={settings.compression_strategy}
                onChange={(e) => setSettings({ ...settings, compression_strategy: e.target.value as ContextSettings["compression_strategy"] })}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="summarise">Summarise oldest messages</option>
                <option value="truncate">Truncate oldest messages</option>
                <option value="sliding_window">Sliding window (keep last N)</option>
              </select>
            </label>

            {settings.compression_strategy === "summarise" && (
              <label className="block text-sm">
                Summarisation model (optional)
                <select
                  value={settings.summarisation_model || ""}
                  onChange={(e) => setSettings({ ...settings, summarisation_model: e.target.value || null })}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Use the active model</option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </label>
            )}

            <SliderRow
              label="Tool-result truncation"
              hint="Maximum characters from any single tool result that get injected into context."
              value={settings.tool_result_max_chars}
              min={500} max={20000} step={500} suffix=" chars"
              onChange={(v) => setSettings({ ...settings, tool_result_max_chars: v })}
            />

            <label className="flex items-center justify-between text-sm">
              Per-conversation context override
              <input
                type="checkbox"
                checked={!!settings.per_conversation_override_enabled}
                onChange={(e) => setSettings({ ...settings, per_conversation_override_enabled: e.target.checked ? 1 : 0 })}
              />
            </label>

            <Button size="sm" disabled={savingSettings} onClick={() => saveSettings(settings)}>
              <Save className="h-3.5 w-3.5" /> {savingSettings ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </Card>

      {/* Context injection toggles (UI-only for now) */}
      <Card className="p-4 space-y-2">
        <p className="text-sm font-medium">What gets injected into context</p>
        <p className="text-xs text-muted-foreground">
          These toggles will gate the engine's auto-injections in V5.1 — currently informational.
        </p>
        {[
          { name: "Memory items", hint: "Stored facts about the user, written by the memory tool." },
          { name: "Knowledge base results", hint: "Semantic search hits from the local knowledge base." },
          { name: "Conversation summary", hint: "Compressed summary of older turns once compression has run." },
        ].map((item) => (
          <label key={item.name} className="flex items-center justify-between text-sm">
            <span>
              <span className="font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">{item.hint}</span>
            </span>
            <input type="checkbox" defaultChecked disabled aria-label={item.name} />
          </label>
        ))}
      </Card>

      {/* Model context table */}
      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Model context sizes</p>
        {models.length === 0 ? (
          <p className="text-xs text-muted-foreground">No models installed yet — pull one from the Models page.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b">
                <th className="py-1">Model</th>
                <th>Context window</th>
                <th>Source</th>
                <th className="text-right">Override</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const src = sourceLabel(m.name);
                const tokens = effectiveTokens(m.name);
                const isEditing = editingModel === m.name;
                const hasOverride = overrides.some((o) => o.model_name === m.name);
                return (
                  <tr key={m.name} className="border-b last:border-0">
                    <td className="py-1.5">
                      {m.name}
                      {activeModel === m.name && <Badge variant="success" className="ml-2">Active</Badge>}
                    </td>
                    <td>
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => saveOverride(m.name, editingValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveOverride(m.name, editingValue);
                            if (e.key === "Escape") setEditingModel(null);
                          }}
                          className="h-7 w-32"
                        />
                      ) : (
                        <button
                          className="hover:underline"
                          onClick={() => { setEditingModel(m.name); setEditingValue(String(tokens)); }}
                          title="Click to override"
                        >
                          {tokens.toLocaleString()}
                        </button>
                      )}
                    </td>
                    <td>
                      <Badge variant={src.tone}>{src.label}</Badge>
                    </td>
                    <td className="text-right">
                      {hasOverride && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => clearOverride(m.name)}
                          title="Clear override"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reset
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function pct(used: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-sm ${color}`} aria-hidden />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value.toLocaleString()}</span>
    </div>
  );
}

function SliderRow({
  label, hint, value, min, max, step, suffix, onChange,
}: {
  label: string; hint: string; value: number; min: number; max: number; step: number; suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <div className="flex items-baseline gap-2">
        <span className="font-medium flex-1">{label}</span>
        <span className="text-xs text-muted-foreground">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </label>
  );
}
