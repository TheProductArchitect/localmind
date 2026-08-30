"use client";
import { useEffect, useState } from "react";
import { Button, Input, Textarea, Badge, EmptyState } from "@/components/ui";
import { PageHeader, PageShell } from "@/components/page-header";
import { toast } from "@/components/toast";

const TABS = [
  { id: "tasks", label: "Scheduled" },
  { id: "monitors", label: "Monitors" },
  { id: "workflows", label: "Workflows" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AutomationsPage() {
  const [tab, setTab] = useState<TabId>("tasks");
  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Automations"
        title="When Sora acts on her own"
        hint="Schedules, page watches, and multi-step workflows. Ask Sora in chat to set a reminder or install a template — or build one here."
      />
      <div className="lm-tabs mb-8" role="tablist" aria-label="Automation type">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`lm-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
            data-pulse="true"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "tasks" && <TasksTab />}
      {tab === "monitors" && <MonitorsTab />}
      {tab === "workflows" && <WorkflowsTab />}
    </PageShell>
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
      <div className="lm-panel space-y-2">
        <p className="lm-micro mb-1">New scheduled task</p>
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Schedule (e.g. 'every morning at 8am' or '0 8 * * *')"
          value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        <Textarea placeholder="What should the assistant do?" rows={2}
          value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <div className="flex gap-2 items-center flex-wrap">
          <select value={form.delivery_channel} onChange={(e) => setForm({ ...form, delivery_channel: e.target.value })}
            className="lm-input h-9">
            <option value="browser">Browser</option>
            <option value="telegram">Telegram</option>
            <option value="email">Email</option>
            <option value="log">Log only</option>
          </select>
          <button type="button" className="lm-action" onClick={add} data-pulse="true">Schedule</button>
        </div>
      </div>
      {tasks.length === 0 && (
        <EmptyState
          showOrb
          title="No scheduled tasks"
          hint="Ask Sora “remind me every Monday…” or schedule a recurring task above."
        />
      )}
      {tasks.map((t) => (
        <div key={t.id} className="lm-panel space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t.name}</p>
              <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
                {t.schedule} → {t.delivery_channel}
                {t.last_run_at ? ` · last ran ${new Date(t.last_run_at).toLocaleString()}` : " · not run yet"}
              </p>
            </div>
            <Badge variant={t.enabled ? "success" : "outline"}>{t.enabled ? "on" : "off"}</Badge>
            <Button size="sm" variant="outline" onClick={() => toggle(t.id, !t.enabled)}>{t.enabled ? "Disable" : "Enable"}</Button>
            <Button size="sm" variant="ghost" onClick={() => del(t.id)}>Delete</Button>
          </div>
          {t.last_output && (
            <details className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <summary className="cursor-pointer text-xs text-white/65">
                Latest result
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/80">
                {t.last_output}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function MonitorsTab() {
  const [monitors, setMonitors] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    check_type: "url_unreachable",
    url: "",
    command: "",
    path: "",
    selector: "main",
    frequency_seconds: 3600,
  });
  const load = () => fetch("/api/automations/monitors").then((r) => r.json()).then((j) => setMonitors(j.monitors || []));
  useEffect(() => { load(); }, []);
  async function add() {
    if (!form.name) return;
    const check_config: any = {};
    if (form.check_type.startsWith("url") || form.check_type === "page_content_change") check_config.url = form.url;
    if (form.check_type === "page_content_change") check_config.selector = form.selector || "main";
    if (form.check_type === "shell") check_config.command = form.command;
    if (form.check_type === "file_change") check_config.path = form.path;
    const j = await (await fetch("/api/automations/monitors", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, check_type: form.check_type, check_config, frequency_seconds: Number(form.frequency_seconds) }),
    })).json();
    toast(j.monitor ? "Monitor created" : j.error || "Failed", j.monitor ? "success" : "error");
    setForm({ name: "", check_type: "url_unreachable", url: "", command: "", path: "", selector: "main", frequency_seconds: 3600 });
    load();
  }
  async function del(id: string) { await fetch(`/api/automations/monitors/${id}`, { method: "DELETE" }); load(); }
  return (
    <div className="space-y-3">
      <div className="lm-panel space-y-2">
        <p className="lm-micro mb-1">New monitor</p>
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.check_type} onChange={(e) => setForm({ ...form, check_type: e.target.value })}
          className="lm-input w-full h-9">
          <option value="url_unreachable">URL becomes unreachable</option>
          <option value="url_reachable">URL becomes reachable</option>
          <option value="page_content_change">Page content changes</option>
          <option value="file_change">File changes</option>
          <option value="shell">Shell command exits 0</option>
        </select>
        {(form.check_type.startsWith("url") || form.check_type === "page_content_change") && (
          <Input placeholder="URL to watch" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        )}
        {form.check_type === "page_content_change" && (
          <Input placeholder="Optional section hint (default: main)" value={form.selector}
            onChange={(e) => setForm({ ...form, selector: e.target.value })} />
        )}
        {form.check_type === "shell" && (
          <Input placeholder="Shell command" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
        )}
        {form.check_type === "file_change" && (
          <Input placeholder="File path" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
        )}
        <div className="flex gap-2 items-center flex-wrap">
          <Input type="number" className="w-32" value={form.frequency_seconds}
            onChange={(e) => setForm({ ...form, frequency_seconds: Number(e.target.value) })} />
          <span className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>seconds between checks</span>
          <button type="button" className="lm-action" onClick={add} data-pulse="true">Create</button>
        </div>
      </div>
      {monitors.length === 0 && (
        <EmptyState
          showOrb
          title="No monitors"
          hint="Watch a URL, file, or page content change. Page watches go through Secure Browser and web-guard."
        />
      )}
      {monitors.map((m) => (
        <div key={m.id} className="lm-panel flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{m.name}</p>
            <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
              {m.check_type} · every {m.frequency_seconds}s
              {m.last_status ? ` · ${m.last_status}` : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => del(m.id)}>Delete</Button>
        </div>
      ))}
    </div>
  );
}

function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const load = () => Promise.all([
    fetch("/api/workflows").then((r) => r.json()),
    fetch("/api/workflows/approvals/pending").then((r) => r.json()),
  ]).then(([w, p]) => {
    setWorkflows(w.workflows || []);
    setTemplates(w.templates || []);
    setPending(p.approvals || []);
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
    if (j.status === "awaiting_approval") {
      toast("Workflow paused — approval required (see Pending approvals below)", "error");
    } else {
      toast(`Workflow ${j.status || "done"} — ${j.results?.length || 0} steps`, j.status === "completed" ? "success" : "error");
    }
    load();
  }
  async function approveRun(runId: string, approved: boolean) {
    const path = approved ? "approve" : "reject";
    const j = await (await fetch(`/api/workflows/runs/${runId}/${path}`, { method: "POST" })).json();
    toast(approved ? `Approved — ${j.status}` : `Rejected`, approved ? "success" : "error");
    load();
  }
  async function del(id: string) { await fetch(`/api/workflows/${id}`, { method: "DELETE" }); load(); }
  return (
    <div className="space-y-3">
      {pending.length > 0 && (
        <div className="lm-panel space-y-2" style={{ boxShadow: "0 0 24px hsl(0 0% 100% / 0.06)" }}>
          <p className="lm-micro">Pending approvals</p>
          {pending.map((a) => (
            <div key={a.run_id} className="flex items-start gap-2 text-sm pt-2" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.08)" }}>
              <div className="flex-1">
                <p className="font-medium">{a.workflow_name}</p>
                <p className="text-xs mt-1" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{a.approval_message || "Approval required"}</p>
              </div>
              <button type="button" className="lm-action" onClick={() => approveRun(a.run_id, true)} data-pulse="true">Approve</button>
              <button type="button" className="lm-action lm-action--ghost" onClick={() => approveRun(a.run_id, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}
      <div className="lm-panel">
        <p className="lm-micro mb-3">Install a template</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ border: "1px solid hsl(0 0% 100% / 0.08)" }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{t.name}</p>
                <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{t.steps.length} steps · {t.trigger_type}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => install(t.id)}>Install</Button>
            </div>
          ))}
        </div>
      </div>
      {workflows.length === 0 && (
        <EmptyState
          showOrb
          title="No workflows yet"
          hint="Install a template above, or ask Sora to create one with manage_workflow."
        />
      )}
      {workflows.map((w) => (
        <div key={w.id} className="lm-panel">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium flex-1">{w.name}</span>
            <span className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{w.steps.length} steps · {w.trigger_type}</span>
            <Button size="sm" onClick={() => run(w.id)}>Run now</Button>
            <Button size="sm" variant="ghost" onClick={() => del(w.id)}>Delete</Button>
          </div>
          <ol className="mt-2 text-xs list-decimal pl-5" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
            {w.steps.map((s: any, i: number) => (
              <li key={i}>{s.type}{s.prompt ? `: ${s.prompt.slice(0, 70)}` : s.tool ? `: ${s.tool}` : s.channel ? `: → ${s.channel}` : ""}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
