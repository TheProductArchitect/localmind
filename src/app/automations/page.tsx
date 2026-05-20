"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Textarea, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";

const TABS = ["Scheduled Tasks", "Monitors", "Workflows"];

export default function AutomationsPage() {
  const [tab, setTab] = useState("Scheduled Tasks");
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Automations</h1>
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-sm border ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Scheduled Tasks" && <TasksTab />}
      {tab === "Monitors" && <MonitorsTab />}
      {tab === "Workflows" && <WorkflowsTab />}
    </div>
  );
}

function TasksTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", schedule: "", prompt: "", delivery_channel: "browser" });
  const load = () => fetch("/api/automations/tasks").then((r) => r.json()).then((j) => setTasks(j.tasks || []));
  useEffect(() => { load(); }, []);
  async function add() {
    if (!form.name || !form.schedule || !form.prompt) return;
    const j = await (await fetch("/api/automations/tasks", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    })).json();
    toast(j.task ? "Task scheduled" : j.error || "Failed", j.task ? "success" : "error");
    setForm({ name: "", schedule: "", prompt: "", delivery_channel: "browser" });
    load();
  }
  async function del(id: string) { await fetch(`/api/automations/tasks/${id}`, { method: "DELETE" }); load(); }
  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/automations/tasks/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    load();
  }
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">New scheduled task</p>
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Schedule (e.g. 'every morning at 8am' or '0 8 * * *')"
          value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        <Textarea placeholder="What should the assistant do?" rows={2}
          value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <div className="flex gap-2 items-center">
          <select value={form.delivery_channel} onChange={(e) => setForm({ ...form, delivery_channel: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="browser">Browser</option>
            <option value="telegram">Telegram</option>
            <option value="email">Email</option>
            <option value="log">Log only</option>
          </select>
          <Button size="sm" onClick={add}>Schedule</Button>
        </div>
      </Card>
      {tasks.length === 0 && <EmptyState title="No scheduled tasks" hint="Schedule a recurring task above — the background worker runs it on time." />}
      {tasks.map((t) => (
        <Card key={t.id} className="p-3 flex items-center gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium">{t.name}</p>
            <p className="text-xs text-muted-foreground">{t.schedule} → {t.delivery_channel}
              {t.last_run_at ? ` · last ran ${new Date(t.last_run_at).toLocaleString()}` : " · not run yet"}</p>
          </div>
          <Badge variant={t.enabled ? "success" : "outline"}>{t.enabled ? "on" : "off"}</Badge>
          <Button size="sm" variant="outline" onClick={() => toggle(t.id, !t.enabled)}>{t.enabled ? "Disable" : "Enable"}</Button>
          <Button size="sm" variant="ghost" onClick={() => del(t.id)}>Delete</Button>
        </Card>
      ))}
    </div>
  );
}

function MonitorsTab() {
  const [monitors, setMonitors] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", check_type: "url_unreachable", url: "", command: "", path: "", frequency_seconds: 3600 });
  const load = () => fetch("/api/automations/monitors").then((r) => r.json()).then((j) => setMonitors(j.monitors || []));
  useEffect(() => { load(); }, []);
  async function add() {
    if (!form.name) return;
    const check_config: any = {};
    if (form.check_type.startsWith("url")) check_config.url = form.url;
    if (form.check_type === "shell") check_config.command = form.command;
    if (form.check_type === "file_change") check_config.path = form.path;
    const j = await (await fetch("/api/automations/monitors", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, check_type: form.check_type, check_config, frequency_seconds: Number(form.frequency_seconds) }),
    })).json();
    toast(j.monitor ? "Monitor created" : j.error || "Failed", j.monitor ? "success" : "error");
    setForm({ name: "", check_type: "url_unreachable", url: "", command: "", path: "", frequency_seconds: 3600 });
    load();
  }
  async function del(id: string) { await fetch(`/api/automations/monitors/${id}`, { method: "DELETE" }); load(); }
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">New monitor</p>
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.check_type} onChange={(e) => setForm({ ...form, check_type: e.target.value })}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="url_unreachable">URL becomes unreachable</option>
          <option value="url_reachable">URL becomes reachable</option>
          <option value="file_change">File changes</option>
          <option value="shell">Shell command exits 0</option>
        </select>
        {form.check_type.startsWith("url") && (
          <Input placeholder="URL to watch" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        )}
        {form.check_type === "shell" && (
          <Input placeholder="Shell command" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
        )}
        {form.check_type === "file_change" && (
          <Input placeholder="File path" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
        )}
        <div className="flex gap-2 items-center">
          <Input type="number" className="w-32" value={form.frequency_seconds}
            onChange={(e) => setForm({ ...form, frequency_seconds: Number(e.target.value) })} />
          <span className="text-xs text-muted-foreground">seconds between checks</span>
          <Button size="sm" onClick={add}>Create</Button>
        </div>
      </Card>
      {monitors.length === 0 && <EmptyState title="No monitors" hint="Create a monitor to watch a condition and alert you when it changes." />}
      {monitors.map((m) => (
        <Card key={m.id} className="p-3 flex items-center gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium">{m.name}</p>
            <p className="text-xs text-muted-foreground">{m.check_type} · every {m.frequency_seconds}s
              {m.last_status ? ` · ${m.last_status}` : ""}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => del(m.id)}>Delete</Button>
        </Card>
      ))}
    </div>
  );
}

function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const load = () => fetch("/api/workflows").then((r) => r.json()).then((j) => {
    setWorkflows(j.workflows || []); setTemplates(j.templates || []);
  });
  useEffect(() => { load(); }, []);
  async function install(templateId: string) {
    await fetch("/api/workflows", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId }),
    });
    toast("Workflow installed", "success");
    load();
  }
  async function run(id: string) {
    toast("Running workflow…");
    const j = await (await fetch(`/api/workflows/${id}/run`, { method: "POST" })).json();
    toast(`Workflow ${j.status || "done"} — ${j.results?.length || 0} steps`, j.status === "completed" ? "success" : "error");
    load();
  }
  async function del(id: string) { await fetch(`/api/workflows/${id}`, { method: "DELETE" }); load(); }
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <p className="font-medium text-sm mb-2">Install a template</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {templates.map((t) => (
            <div key={t.id} className="border rounded p-2 flex items-center gap-2">
              <div className="flex-1">
                <p className="text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.steps.length} steps · {t.trigger_type}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => install(t.id)}>Install</Button>
            </div>
          ))}
        </div>
      </Card>
      {workflows.length === 0 && <EmptyState title="No workflows yet" hint="Install a template above to get started, then customise its steps." />}
      {workflows.map((w) => (
        <Card key={w.id} className="p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium flex-1">{w.name}</span>
            <span className="text-xs text-muted-foreground">{w.steps.length} steps · {w.trigger_type}</span>
            <Button size="sm" onClick={() => run(w.id)}>Run now</Button>
            <Button size="sm" variant="ghost" onClick={() => del(w.id)}>Delete</Button>
          </div>
          <ol className="mt-2 text-xs text-muted-foreground list-decimal pl-5">
            {w.steps.map((s: any, i: number) => (
              <li key={i}>{s.type}{s.prompt ? `: ${s.prompt.slice(0, 70)}` : s.tool ? `: ${s.tool}` : s.channel ? `: → ${s.channel}` : ""}</li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
