"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, EmptyState, Badge } from "@/components/ui";
import { toast } from "@/components/toast";

export default function TodayPage() {
  const [briefing, setBriefing] = useState("");
  const [goals, setGoals] = useState<any[]>([]);
  const [goalForm, setGoalForm] = useState({ description: "", target_date: "" });
  const [focusActive, setFocusActive] = useState(false);
  const [focusTask, setFocusTask] = useState("");
  const [busy, setBusy] = useState(false);

  const loadGoals = () => fetch("/api/goals").then((r) => r.json()).then((j) => setGoals(j.goals || []));
  useEffect(() => { loadGoals(); }, []);

  async function genBriefing(kind: string) {
    setBusy(true);
    setBriefing("Generating…");
    const j = await (await fetch("/api/proactive/briefing", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }),
    })).json();
    setBriefing(j.briefing || j.error || "Failed");
    setBusy(false);
  }
  async function addGoal() {
    if (!goalForm.description) return;
    await fetch("/api/goals", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(goalForm),
    });
    setGoalForm({ description: "", target_date: "" });
    loadGoals();
  }
  async function updateGoal(id: string, progress: number) {
    await fetch(`/api/goals/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ progress }),
    });
    loadGoals();
  }
  async function delGoal(id: string) { await fetch(`/api/goals/${id}`, { method: "DELETE" }); loadGoals(); }
  async function toggleFocus() {
    const next = !focusActive;
    const j = await (await fetch("/api/focus", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next, task: focusTask }),
    })).json();
    setFocusActive(next);
    toast(j.message || "Focus toggled", "success");
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Today</h1>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm flex-1">Briefing</p>
          <Button size="sm" disabled={busy} onClick={() => genBriefing("briefing")}>Morning briefing</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => genBriefing("weekly")}>Weekly review</Button>
        </div>
        {briefing
          ? <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3">{briefing}</pre>
          : <p className="text-xs text-muted-foreground">Generate a briefing to see your day at a glance.</p>}
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Focus mode</p>
        <div className="flex gap-2">
          <Input placeholder="What are you focusing on?" value={focusTask}
            onChange={(e) => setFocusTask(e.target.value)} />
          <Button size="sm" variant={focusActive ? "destructive" : "default"} onClick={toggleFocus}>
            {focusActive ? "End focus session" : "Start focus session"}
          </Button>
        </div>
        {focusActive && <p className="text-xs text-muted-foreground">Focus session active — notifications quieted.</p>}
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Goals</p>
        <div className="flex gap-2">
          <Input placeholder="Goal (plain English)" value={goalForm.description}
            onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
          <Input placeholder="Target date" className="w-36" value={goalForm.target_date}
            onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} />
          <Button size="sm" onClick={addGoal}>Add</Button>
        </div>
        {goals.length === 0 && <EmptyState title="No goals yet" hint="Define a goal and the assistant will track your progress." />}
        {goals.map((g) => (
          <div key={g.id} className="border rounded p-2">
            <div className="flex items-center gap-2">
              <span className="text-sm flex-1">{g.description}</span>
              {g.target_date && <Badge variant="outline">{g.target_date}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => delGoal(g.id)}>✕</Button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input type="range" min={0} max={100} value={g.progress}
                onChange={(e) => updateGoal(g.id, Number(e.target.value))} className="flex-1" />
              <span className="text-xs text-muted-foreground w-10">{g.progress}%</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
