"use client";

/**
 * /agent/system-prompt — editorial control over every word Sora reads.
 *
 * v2 design: vertical stack of blocks (drag to reorder), each expandable
 * with full content edit. Built-in blocks show their auto-generated default
 * inline; the user can override the entire block with custom text or fall
 * back to the default by clearing the override. Custom blocks (static or
 * conditional) are free-form.
 *
 * The right pane shows the live assembled prompt — exactly what the LLM
 * will see — with a token estimate and a small "test prompt" sandbox.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Textarea, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, Trash2, GripVertical, Eye, Send, Save, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";

type Persona = { persona_id: string; name: string; description: string | null; enabled_tools?: string };
type AvailableTool = { name: string; description: string; action_type: string };

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
  identity:     "Who Sora is — her name, personality, the security rules, orchestrator hierarchy, subagent protocol. The bedrock.",
  permissions:  "Active operating mode (auto/plan/ask) + the permission profile breakdown.",
  tools:        "Which tools this persona may call.",
  memory:       "Persistent memory about the user — auto-injected from your stored memory.",
  date_context: "Current date and platform — keeps Sora grounded in time.",
};

const VARIABLES = ["{assistant_name}", "{active_model}", "{user_name}", "{persona_name}"];

export default function SystemPromptPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [preview, setPreview] = useState<{ assembled: string; tokenEstimate: number } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState<string | null>(null);

  // Tools state — registry + per-persona enabled set.
  const [allTools, setAllTools] = useState<AvailableTool[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [toolsDirty, setToolsDirty] = useState(false);

  useEffect(() => {
    fetch("/api/agent/personas")
      .then((r) => r.json())
      .then((j) => {
        setPersonas(j.personas || []);
        setPersonaId(j.personas?.[0]?.persona_id || "persona-general");
      })
      .catch(() => setPersonas([]));
    fetch("/api/tools")
      .then((r) => r.json())
      .then((j) => setAllTools(j.tools || []))
      .catch(() => setAllTools([]));
  }, []);

  // When the selected persona changes, refresh its enabled-tools set.
  useEffect(() => {
    if (!personaId) return;
    const p = personas.find((x) => x.persona_id === personaId);
    if (!p) return;
    let enabled: string[] = [];
    try { enabled = JSON.parse(p.enabled_tools || "[]") as string[]; } catch { enabled = []; }
    setEnabledTools(new Set(enabled));
    setToolsDirty(false);
  }, [personaId, personas]);

  function toggleTool(name: string) {
    setEnabledTools((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
    setToolsDirty(true);
  }
  function selectAllTools()  { setEnabledTools(new Set(allTools.map((t) => t.name))); setToolsDirty(true); }
  function selectNoneTools() { setEnabledTools(new Set()); setToolsDirty(true); }
  async function saveTools() {
    if (!personaId) return;
    const r = await fetch(`/api/agent/personas/${personaId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled_tools: Array.from(enabledTools) }),
    });
    if (!r.ok) { toast("Could not save tools", "error"); return; }
    toast("Tools saved", "success");
    setToolsDirty(false);
    // Refresh personas + preview so the system prompt mirrors the new tool set.
    const j = await (await fetch("/api/agent/personas")).json();
    setPersonas(j.personas || []);
    loadPreview(personaId);
  }

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

  const loadDefaults = useCallback(async (id: string) => {
    const r = await fetch(`/api/agent/system-prompt/${id}?defaults=1`);
    const j = await r.json();
    setDefaults(j.defaults || {});
  }, []);

  useEffect(() => {
    if (!personaId) return;
    loadBlocks(personaId);
    loadPreview(personaId);
    loadDefaults(personaId);
  }, [personaId, loadBlocks, loadPreview, loadDefaults]);

  function updateBlock(i: number, patch: Partial<Block>) {
    setBlocks((cur) => cur.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function toggleEnabled(i: number) {
    setBlocks((cur) => cur.map((b, idx) => (idx === i ? { ...b, enabled: b.enabled ? 0 : 1 } : b)));
  }
  function deleteBlock(i: number) {
    setBlocks((cur) => cur.filter((_, idx) => idx !== i));
  }
  function addCustom(type: BlockType) {
    setBlocks((cur) => [
      ...cur,
      {
        block_type: type,
        block_name: type === "custom-conditional" ? "After hours" : "Custom",
        content: "",
        enabled: 1,
        sort_order: cur.length,
        condition_json: type === "custom-conditional" ? '{"hour_range":[19,23]}' : null,
      },
    ]);
  }
  function onDragStart(i: number) { setDragIdx(i); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(i: number) {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); return; }
    setBlocks((cur) => {
      const next = [...cur];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(i, 0, moved);
      return next.map((b, idx) => ({ ...b, sort_order: idx }));
    });
    setDragIdx(null);
  }

  async function save() {
    if (!personaId) return;
    setSaving(true);
    try {
      const payload = blocks.map((b, i) => ({
        block_id: b.block_id,
        block_type: b.block_type,
        block_name: b.block_name,
        content: b.content,
        enabled: !!b.enabled,
        sort_order: i,
        condition_json: b.condition_json,
      }));
      const r = await fetch(`/api/agent/system-prompt/${personaId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocks: payload }),
      });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Save failed", "error"); return; }
      toast("Saved", "success");
      await loadBlocks(personaId);
      await loadPreview(personaId);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!personaId || !testMessage.trim()) return;
    const r = await fetch(`/api/agent/system-prompt/${personaId}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: testMessage }),
    });
    const j = await r.json();
    setTestResponse(j.response || j.error || "(no response)");
  }

  const tokenWarning = useMemo(() => (preview?.tokenEstimate || 0) > 3000, [preview]);

  // Visible blocks = everything except disabled built-ins. Disabled built-ins
  // (`memory`, `date_context` by default) live in the "Add block" menu below
  // so the editor doesn't show ghost rows the user has explicitly turned off.
  // We preserve `originalIndex` so drag/drop and updateBlock still address the
  // right entry in the underlying `blocks` array.
  const visibleBlocks = useMemo(
    () =>
      blocks
        .map((block, originalIndex) => ({ block, originalIndex }))
        .filter(({ block }) => !(block.block_type === "builtin" && !block.enabled)),
    [blocks]
  );

  // Disabled built-ins available to re-add via the "Add block" menu.
  const disabledBuiltins = useMemo(
    () =>
      blocks
        .map((block, originalIndex) => ({ block, originalIndex }))
        .filter(({ block }) => block.block_type === "builtin" && !block.enabled),
    [blocks]
  );

  function reEnableBuiltin(idx: number) {
    setBlocks((cur) => cur.map((b, i) => (i === idx ? { ...b, enabled: 1 } : b)));
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-10 py-14" style={{ maxWidth: 780 }}>
        <div className="flex items-end justify-between gap-6 mb-10">
          <div>
            <p className="lm-micro mb-2">Agent · prompt</p>
            <h1 className="lm-display">How Sora speaks</h1>
            <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
              Every word Sora reads before your turn is one of these blocks. Drag to reorder,
              toggle to enable, override built-ins by typing your own version.
            </p>
          </div>
          <Button onClick={save} disabled={saving || loading} data-pulse-action="save">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {/* Persona switcher */}
        <div className="flex items-center gap-3 mb-10">
          <label className="lm-micro">Persona</label>
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="lm-input"
            style={{ width: 220 }}
          >
            {personas.map((p) => (
              <option key={p.persona_id} value={p.persona_id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* === 1. System prompt blocks === */}
        <section className="mb-12">
          <header className="mb-4">
            <p className="lm-micro">System prompt</p>
            <p className="lm-body mt-1 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)", fontSize: 12 }}>
              Every word Sora reads before your turn. Drag to reorder; override built-ins by typing your own version.
            </p>
          </header>
        {loading ? (
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading blocks…</p>
        ) : visibleBlocks.length === 0 ? (
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>No blocks. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {visibleBlocks.map(({ block: b, originalIndex: i }) => {
              const id = b.block_id || `${b.block_name}-${i}`;
              const isOpen = !!expanded[id];
              const isBuiltin = b.block_type === "builtin";
              const hasOverride = !!(b.content || "").trim();
              const defaultText = isBuiltin ? (defaults[b.block_name] || "") : "";
              return (
                <div
                  key={id}
                  className="lm-block"
                  data-disabled={!b.enabled}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(i)}
                  style={{ opacity: dragIdx === i ? 0.5 : 1 }}
                >
                  <div className="lm-block__head">
                    <GripVertical className="h-4 w-4 cursor-grab" style={{ color: "hsl(0 0% 100% / 0.3)" }} aria-hidden />
                    <button
                      onClick={() => setExpanded((cur) => ({ ...cur, [id]: !cur[id] }))}
                      className="lm-block__toggle"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                      data-pulse="true"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500 }}>
                      {b.block_name}
                    </span>
                    {isBuiltin ? (
                      <Badge variant={hasOverride ? "default" : "outline"}>
                        {hasOverride ? "overridden" : "built-in"}
                      </Badge>
                    ) : (
                      <Badge>{b.block_type === "custom-static" ? "custom" : "conditional"}</Badge>
                    )}
                    {!isBuiltin && (
                      <button
                        onClick={() => deleteBlock(i)}
                        className="lm-row__del ml-auto"
                        aria-label="Delete block"
                        data-pulse="true"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isBuiltin && (
                      <button
                        onClick={() => toggleEnabled(i)}
                        className="lm-row__del ml-auto"
                        aria-label="Disable this block"
                        title="Disable — block moves to Add menu"
                        data-pulse="true"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="lm-block__body">
                      {isBuiltin && (
                        <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                          {BUILTIN_DESCRIPTIONS[b.block_name] || "Built-in block."}
                        </p>
                      )}

                      {!isBuiltin && (
                        <Input
                          value={b.block_name}
                          onChange={(e) => updateBlock(i, { block_name: e.target.value })}
                          placeholder="Block name"
                        />
                      )}

                      <Textarea
                        rows={Math.min(20, Math.max(6, (isBuiltin && !hasOverride ? defaultText : b.content).split("\n").length + 1))}
                        value={hasOverride || !isBuiltin ? b.content : defaultText}
                        readOnly={isBuiltin && !hasOverride}
                        onChange={(e) => updateBlock(i, { content: e.target.value })}
                        placeholder={isBuiltin
                          ? "Click 'Customize' below to override the auto-generated content."
                          : "Content. Use {assistant_name}, {active_model}, {user_name}, {persona_name} for variables."}
                        style={{
                          fontFamily: "ui-monospace, SF Mono, monospace",
                          fontSize: 12,
                          lineHeight: "20px",
                          background: isBuiltin && !hasOverride ? "hsl(0 0% 100% / 0.02)" : undefined,
                          color: isBuiltin && !hasOverride ? "hsl(0 0% 100% / 0.55)" : undefined,
                        }}
                      />

                      {isBuiltin && (
                        <div className="flex items-center gap-2">
                          {!hasOverride ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateBlock(i, { content: defaultText })}
                            >
                              Customize this block
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateBlock(i, { content: "" })}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Revert to auto-generated
                            </Button>
                          )}
                          <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                            {hasOverride
                              ? "Custom — your text is sent to the LLM."
                              : "Auto-generated — content updates as you change settings/memory."}
                          </p>
                        </div>
                      )}

                      {b.block_type === "custom-conditional" && (
                        <div>
                          <p className="lm-micro mb-1">Condition JSON</p>
                          <Textarea
                            rows={3}
                            value={b.condition_json || ""}
                            onChange={(e) => updateBlock(i, { condition_json: e.target.value })}
                            placeholder='{"weekday":[1,2,3,4,5]} or {"persona":"persona-devpm"} or {"hour_range":[9,17]}'
                            style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

          {/* Add block menu */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="lm-micro">Add:</span>
            {disabledBuiltins.map(({ block, originalIndex }) => (
              <button
                key={block.block_name}
                onClick={() => reEnableBuiltin(originalIndex)}
                className="lm-add-chip"
                data-pulse="true"
                title={BUILTIN_DESCRIPTIONS[block.block_name] || "Built-in block."}
              >
                <Plus className="h-3 w-3" /> {block.block_name}
              </button>
            ))}
            <button onClick={() => addCustom("custom-static")} className="lm-add-chip" data-pulse="true">
              <Plus className="h-3 w-3" /> static block
            </button>
            <button onClick={() => addCustom("custom-conditional")} className="lm-add-chip" data-pulse="true">
              <Plus className="h-3 w-3" /> conditional block
            </button>
          </div>
        </section>

        {/* === 2. Tools available to this persona === */}
        <section className="mb-12">
          <header className="flex items-end justify-between mb-4">
            <div>
              <p className="lm-micro">Tools</p>
              <p className="lm-body mt-1 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)", fontSize: 12 }}>
                What Sora may call. The system prompt&apos;s <code style={{ fontFamily: "ui-monospace,monospace" }}>tools</code> block lists
                exactly these, with descriptions, so she always knows her surface.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={selectAllTools}>All</Button>
              <Button size="sm" variant="ghost" onClick={selectNoneTools}>None</Button>
              <Button size="sm" onClick={saveTools} disabled={!toolsDirty} data-pulse-action="save">Save tools</Button>
            </div>
          </header>
          {allTools.length === 0 ? (
            <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allTools.map((t) => {
                const on = enabledTools.has(t.name);
                return (
                  <label key={t.name} className="lm-tool-tile" data-on={on} data-pulse="true">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleTool(t.name)}
                      aria-label={t.name}
                    />
                    <div className="lm-tool-tile__body">
                      <span className="lm-body" style={{ color: on ? "hsl(0 0% 100%)" : "hsl(0 0% 100% / 0.78)", fontWeight: 500 }}>
                        {t.name}
                      </span>
                      <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, color: "hsl(0 0% 100% / 0.5)" }}>
                        {t.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Right — live preview */}
      <aside
        className="hidden lg:flex flex-col overflow-hidden"
        style={{
          width: 420,
          borderLeft: "1px solid hsl(0 0% 100% / 0.06)",
          background: "hsl(234 22% 4% / 0.4)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.06)" }}>
          <Eye className="h-4 w-4" style={{ color: "hsl(0 0% 100% / 0.55)" }} />
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500 }}>What Sora sees</p>
          {preview && (
            <span className="ml-auto lm-chip" data-tone={tokenWarning ? "fail" : undefined}>
              ~{preview.tokenEstimate} tokens
            </span>
          )}
        </div>
        {tokenWarning && (
          <p className="lm-micro px-5 py-2" style={{ textTransform: "none", letterSpacing: 0, borderBottom: "1px solid hsl(0 0% 100% / 0.06)", color: "hsl(40 100% 78%)" }}>
            Long prompts leave less room for conversation and tool results.
          </p>
        )}
        <pre className="flex-1 overflow-y-auto px-5 py-4" style={{
          fontFamily: "ui-monospace, SF Mono, monospace",
          fontSize: 11.5, lineHeight: "18px",
          color: "hsl(0 0% 100% / 0.82)",
          whiteSpace: "pre-wrap",
        }}>
          {preview ? preview.assembled || "(empty)" : "Loading…"}
        </pre>
        <div className="px-5 py-3 space-y-2" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.06)" }}>
          <details>
            <summary className="lm-micro" style={{ cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>Variables</summary>
            <div className="flex flex-wrap gap-1 mt-2">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  className="lm-chip"
                  onClick={() => { navigator.clipboard.writeText(v); toast(`${v} copied`); }}
                  data-pulse="true"
                  style={{ fontFamily: "ui-monospace, monospace", textTransform: "none", letterSpacing: 0 }}
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
            <div className="space-y-2" style={{ background: "hsl(0 0% 100% / 0.03)", padding: 10, borderRadius: 12, border: "1px solid hsl(0 0% 100% / 0.08)" }}>
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
                <pre className="px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.04)", borderRadius: 8, fontSize: 11.5, whiteSpace: "pre-wrap" }}>
                  {testResponse}
                </pre>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
