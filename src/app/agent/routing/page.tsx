"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { Route, Plus, Trash2, GripVertical, Zap } from "lucide-react";

type Rule = {
  rule_id: string;
  sort_order: number;
  condition_type: "task_type" | "message_length" | "tool_required" | "persona_active" | "time_of_day" | "manual_override";
  condition_value: string | null;
  target_agent_name: string;
  enabled: number;
  created_at: number;
};

type Persona = { persona_id: string; name: string };

const CONDITION_HELP: Record<string, string> = {
  task_type: 'Comma-separated list of task types. Examples: "code", "research,writing", "quick_lookup".',
  message_length: 'Compare the user message length in characters. Examples: ">500", "<200", "100-1000".',
  tool_required: 'Comma-separated tool names. The rule fires if any of these tools are likely needed.',
  persona_active: 'Persona id or name. Examples: "persona-devpm", "DevPM".',
  time_of_day: 'Inclusive-low / exclusive-high hour range in local time. Example: "9-17" for work hours.',
};

const CONDITION_TYPES: Rule["condition_type"][] = [
  "task_type",
  "message_length",
  "tool_required",
  "persona_active",
  "time_of_day",
];

export default function RoutingPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const [newCond, setNewCond] = useState<Rule["condition_type"]>("task_type");
  const [newVal, setNewVal] = useState("");
  const [newTarget, setNewTarget] = useState("Main");

  // Evaluator panel
  const [testTaskType, setTestTaskType] = useState("research");
  const [testLen, setTestLen] = useState(120);
  const [testTools, setTestTools] = useState("web_search");
  const [testPersona, setTestPersona] = useState("persona-general");
  const [testManual, setTestManual] = useState("");
  const [testResult, setTestResult] = useState<{ target: string; rule_id: string } | null>(null);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      fetch("/api/agent/routing-rules").then((r) => r.json()),
      fetch("/api/agent/personas").then((r) => r.json()),
    ]);
    setRules(r.rules || []);
    setPersonas(p.personas || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!newTarget.trim()) return;
    const r = await fetch("/api/agent/routing-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        condition_type: newCond,
        condition_value: newVal || null,
        target_agent_name: newTarget,
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Could not add rule", "error");
      return;
    }
    setNewVal("");
    load();
  }

  async function patchRule(id: string, patch: Partial<Rule>) {
    const r = await fetch(`/api/agent/routing-rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Save failed", "error");
      return;
    }
    load();
  }

  async function removeRule(id: string) {
    if (!confirm("Delete this routing rule?")) return;
    await fetch(`/api/agent/routing-rules/${id}`, { method: "DELETE" });
    load();
  }

  async function commitReorder(ordered: Rule[]) {
    await fetch("/api/agent/routing-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ordered.map((r) => r.rule_id) }),
    });
    load();
  }

  function onDragStart(i: number) { setDragIdx(i); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(target: number) {
    if (dragIdx === null || dragIdx === target) { setDragIdx(null); return; }
    setRules((cur) => {
      const next = [...cur];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(target, 0, moved);
      commitReorder(next);
      return next;
    });
    setDragIdx(null);
  }

  async function evaluate() {
    const qs = new URLSearchParams({
      evaluate: "1",
      task_type: testTaskType,
      message_length: String(testLen),
      required_tools: testTools,
      active_persona: testPersona,
    });
    if (testManual) qs.set("manual_override_agent", testManual);
    const r = await fetch(`/api/agent/routing-rules?${qs}`);
    const j = await r.json();
    if (j.match) {
      setTestResult({ target: j.match.target_agent_name, rule_id: j.match.rule_id });
    } else {
      setTestResult({ target: "(default — no rule matched)", rule_id: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-14 space-y-6">
      <div className="mb-2">
        <p className="lm-micro mb-2">Agent · routing</p>
        <h1 className="lm-display">Which model, when</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Rules are evaluated top to bottom — the first match wins. Manual override (typing <code>@AgentName</code> in chat) always takes precedence.
        Routing applies to the agent roster you define; if no rule matches, the default model is used.
      </p>

      {/* New rule */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          <p className="text-sm font-medium">Add a routing rule</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <select
            value={newCond}
            onChange={(e) => setNewCond(e.target.value as Rule["condition_type"])}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {CONDITION_TYPES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
          <Input
            placeholder="Condition value (see hint)"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            className="sm:col-span-2"
          />
          <Input
            placeholder="Target agent name"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">{CONDITION_HELP[newCond]}</p>
        <Button size="sm" onClick={add} disabled={!newTarget.trim()}>
          Add rule
        </Button>
      </Card>

      {/* Rule list */}
      <Card className="p-0 overflow-hidden">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">
            No routing rules yet. Without rules, every conversation uses the default model from settings.
          </p>
        ) : (
          <ul className="divide-y">
            {rules.map((r, i) => (
              <li
                key={r.rule_id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
                className={`flex items-center gap-2 p-3 ${dragIdx === i ? "opacity-60" : ""}`}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                <Badge variant="outline">{r.condition_type.replace(/_/g, " ")}</Badge>
                <Input
                  value={r.condition_value || ""}
                  onChange={(e) => setRules((cur) => cur.map((x) => (x.rule_id === r.rule_id ? { ...x, condition_value: e.target.value } : x)))}
                  onBlur={(e) => patchRule(r.rule_id, { condition_value: e.target.value || null })}
                  className="h-8 max-w-[18rem]"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  value={r.target_agent_name}
                  onChange={(e) => setRules((cur) => cur.map((x) => (x.rule_id === r.rule_id ? { ...x, target_agent_name: e.target.value } : x)))}
                  onBlur={(e) => patchRule(r.rule_id, { target_agent_name: e.target.value })}
                  className="h-8 max-w-[12rem]"
                />
                <label className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!r.enabled}
                    onChange={(e) => patchRule(r.rule_id, { enabled: e.target.checked ? 1 : 0 })}
                  />
                  Enabled
                </label>
                <Button size="sm" variant="ghost" onClick={() => removeRule(r.rule_id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Evaluator */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          <p className="text-sm font-medium">Try the routing</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-sm">
            Task type
            <Input value={testTaskType} onChange={(e) => setTestTaskType(e.target.value)} className="mt-1" />
          </label>
          <label className="text-sm">
            Message length (chars)
            <Input
              type="number"
              value={testLen}
              onChange={(e) => setTestLen(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1"
            />
          </label>
          <label className="text-sm">
            Required tools (comma-separated)
            <Input value={testTools} onChange={(e) => setTestTools(e.target.value)} className="mt-1" />
          </label>
          <label className="text-sm">
            Active persona
            <select
              value={testPersona}
              onChange={(e) => setTestPersona(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {personas.map((p) => (
                <option key={p.persona_id} value={p.persona_id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            Manual override (the @AgentName prefix in chat)
            <Input
              value={testManual}
              onChange={(e) => setTestManual(e.target.value)}
              placeholder="Leave blank to test the rules"
              className="mt-1"
            />
          </label>
        </div>
        <Button size="sm" onClick={evaluate}>Evaluate</Button>
        {testResult && (
          <p className="text-sm">
            Would route to <Badge variant="success">{testResult.target}</Badge>
            {testResult.rule_id && testResult.rule_id !== "manual-override" && (
              <span className="ml-2 text-xs text-muted-foreground">via rule {testResult.rule_id}</span>
            )}
            {testResult.rule_id === "manual-override" && (
              <span className="ml-2 text-xs text-muted-foreground">via manual @-override</span>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The agent engine consults this evaluator on every turn — wiring into the model dispatcher is in progress and lands in V5.1.
        </p>
      </Card>
    </div>
  );
}
