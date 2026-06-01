"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Textarea, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, Trash2, GripVertical, Eye, Send, Save, Sparkles } from "lucide-react";

type Persona = {
  persona_id: string;
  name: string;
  description: string | null;
};

type BlockType = "builtin" | "custom-static" | "custom-conditional";

type Block = {
  block_id?: string;
  block_type: BlockType;
  block_name: string;
  content: string;
  enabled: number | boolean;
  sort_order: number;
  condition_json: string | null;
};

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  identity: "Assistant identity, personality, and the security rules. Auto-generated from settings + persona.",
  permissions: "Summary of the active permission profile — which actions are allowed / ask first / require PIN.",
  tools: "Tools available to this persona, subject to the permission profile.",
  memory: "Stored facts about the user, scoped to the authenticated account.",
  date_context: "Current date and platform information.",
};

const VARIABLES = ["{assistant_name}", "{active_model}", "{user_name}", "{persona_name}"];

export default function SystemPromptPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const [preview, setPreview] = useState<{ assembled: string; tokenEstimate: number } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agent/personas")
      .then((r) => r.json())
      .then((j) => {
        setPersonas(j.personas || []);
        setPersonaId(j.personas?.[0]?.persona_id || "persona-general");
      })
      .catch(() => setPersonas([]));
  }, []);

  const loadBlocks = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/agent/system-prompt/${id}`);
      const j = await r.json();
      setBlocks(j.blocks || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async (id: string) => {
    const r = await fetch(`/api/agent/system-prompt/${id}?preview=1`);
    const j = await r.json();
    setPreview({ assembled: j.assembled || "", tokenEstimate: j.tokenEstimate || 0 });
  }, []);

  useEffect(() => {
    if (!personaId) return;
    loadBlocks(personaId);
    loadPreview(personaId);
  }, [personaId, loadBlocks, loadPreview]);

  function toggleEnabled(i: number) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, enabled: b.enabled ? 0 : 1 } : b)));
  }

  function updateBlock(i: number, patch: Partial<Block>) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function deleteBlock(i: number) {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
  }

  function addCustom(type: "custom-static" | "custom-conditional") {
    setBlocks((bs) => [
      ...bs,
      {
        block_type: type,
        block_name: type === "custom-static" ? "Custom instructions" : "Conditional instructions",
        content: "",
        enabled: 1,
        sort_order: bs.length,
        condition_json: type === "custom-conditional" ? '{"weekday":[1,2,3,4,5]}' : null,
      },
    ]);
  }

  function onDragStart(i: number) {
    setDragIdx(i);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(target: number) {
    if (dragIdx === null || dragIdx === target) {
      setDragIdx(null);
      return;
    }
    setBlocks((bs) => {
      const next = [...bs];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(target, 0, moved);
      return next.map((b, i) => ({ ...b, sort_order: i }));
    });
    setDragIdx(null);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/agent/system-prompt/${personaId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast(j.error || "Could not save.", "error");
        return;
      }
      toast("Saved", "success");
      await loadBlocks(personaId);
      await loadPreview(personaId);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTestResponse("Running…");
    const r = await fetch(`/api/agent/system-prompt/${personaId}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: testMessage }),
    });
    const j = await r.json();
    if (!r.ok) {
      setTestResponse(j.error || "Test failed.");
    } else {
      setTestResponse(j.response || "(no response)");
    }
  }

  const tokenWarning = useMemo(
    () => preview && preview.tokenEstimate > 2000,
    [preview]
  );

  return (
    <div className="flex h-full">
      {/* Left — composer */}
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5" />
          <h1 className="text-xl font-semibold flex-1">System Prompt</h1>
          <Button size="sm" onClick={save} disabled={saving || loading}>
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        <Card className="p-3 mb-4">
          <label className="block text-sm">
            Persona
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {personas.map((p) => (
                <option key={p.persona_id} value={p.persona_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {personas.find((p) => p.persona_id === personaId)?.description && (
            <p className="text-xs text-muted-foreground mt-2">
              {personas.find((p) => p.persona_id === personaId)?.description}
            </p>
          )}
        </Card>

        <div className="flex gap-2 mb-3">
          <Button size="sm" variant="outline" onClick={() => addCustom("custom-static")}>
            <Plus className="h-3.5 w-3.5" /> Add static block
          </Button>
          <Button size="sm" variant="outline" onClick={() => addCustom("custom-conditional")}>
            <Plus className="h-3.5 w-3.5" /> Add conditional block
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading blocks…</p>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocks yet.</p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <Card
                key={`${b.block_id || b.block_name}-${i}`}
                className={`p-3 ${dragIdx === i ? "opacity-60" : ""}`}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
              >
                <div className="flex items-center gap-2">
                  <GripVertical
                    className="h-4 w-4 text-muted-foreground cursor-grab"
                    aria-hidden
                  />
                  <span className="font-medium text-sm flex-1">{b.block_name}</span>
                  <Badge variant={b.block_type === "builtin" ? "outline" : "default"}>
                    {b.block_type === "builtin" ? "built-in" : b.block_type === "custom-static" ? "custom" : "conditional"}
                  </Badge>
                  <label className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!b.enabled}
                      onChange={() => toggleEnabled(i)}
                      aria-label={`Enable ${b.block_name}`}
                    />
                    Enabled
                  </label>
                  {b.block_type !== "builtin" && (
                    <button
                      onClick={() => deleteBlock(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {b.block_type === "builtin" ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    {BUILTIN_DESCRIPTIONS[b.block_name] || "Built-in block."}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Input
                      value={b.block_name}
                      onChange={(e) => updateBlock(i, { block_name: e.target.value })}
                      placeholder="Block name"
                    />
                    <Textarea
                      rows={Math.min(12, Math.max(4, b.content.split("\n").length + 1))}
                      value={b.content}
                      onChange={(e) => updateBlock(i, { content: e.target.value })}
                      placeholder="Content. Use {assistant_name}, {active_model}, {user_name}, {persona_name} for variables."
                    />
                    {b.block_type === "custom-conditional" && (
                      <Textarea
                        rows={3}
                        value={b.condition_json || ""}
                        onChange={(e) => updateBlock(i, { condition_json: e.target.value })}
                        placeholder='Condition JSON, e.g. {"weekday":[1,2,3,4,5]} or {"persona":"persona-devpm"}'
                      />
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Right — live preview */}
      <div className="w-[40%] min-w-[360px] border-l flex flex-col bg-muted/10">
        <div className="border-b px-4 py-2 flex items-center gap-2">
          <Eye className="h-4 w-4" />
          <p className="text-sm font-medium flex-1">Live preview</p>
          {preview && (
            <Badge variant={tokenWarning ? "warning" : "outline"}>
              ~{preview.tokenEstimate} tokens
            </Badge>
          )}
        </div>
        {tokenWarning && (
          <p className="text-xs text-amber-600 px-4 py-1.5 border-b">
            System prompt is large — long prompts leave less room for conversation history and tool results.
          </p>
        )}

        <pre className="flex-1 overflow-y-auto p-4 text-xs whitespace-pre-wrap font-mono">
          {preview ? preview.assembled || "(empty)" : "Loading…"}
        </pre>

        <div className="border-t p-3 space-y-2">
          <details>
            <summary className="text-xs text-muted-foreground cursor-pointer">Variables</summary>
            <div className="flex flex-wrap gap-1 mt-2">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  className="text-xs font-mono rounded border bg-background px-2 py-0.5 hover:bg-accent"
                  onClick={() => {
                    navigator.clipboard.writeText(v);
                    toast(`${v} copied`);
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </details>

          <Button size="sm" variant="outline" className="w-full" onClick={() => setTestOpen((o) => !o)}>
            <Send className="h-3.5 w-3.5" /> {testOpen ? "Hide test" : "Test prompt"}
          </Button>
          {testOpen && (
            <div className="space-y-2 border rounded-md p-2 bg-background">
              <Textarea
                rows={3}
                placeholder="Test message…"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
              <Button size="sm" onClick={runTest} disabled={!testMessage.trim()}>
                Send
              </Button>
              {testResponse && (
                <pre className="text-xs bg-muted/40 rounded p-2 whitespace-pre-wrap">
                  {testResponse}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
