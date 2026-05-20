"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";

const TABS = ["Servers", "Tool Registry", "Registry Browser", "Server Builder"];

export default function McpPage() {
  const [tab, setTab] = useState("Servers");
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-3">MCP Servers</h1>
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-sm border ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Servers" && <ServersTab />}
      {tab === "Tool Registry" && <ToolRegistryTab />}
      {tab === "Registry Browser" && <RegistryTab />}
      {tab === "Server Builder" && <BuilderTab />}
    </div>
  );
}

function ServersTab() {
  const [servers, setServers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", url: "", transport: "sse", command: "", tier: "ask", description: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = () => fetch("/api/mcp/servers").then((r) => r.json()).then((j) => setServers(j.servers || []));
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.name) return;
    const r = await fetch("/api/mcp/servers", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    const j = await r.json();
    toast(j.server ? "Server added" : j.error || "Failed", j.server ? "success" : "error");
    setForm({ name: "", url: "", transport: "sse", command: "", tier: "ask", description: "" });
    load();
  }
  async function test() {
    const r = await fetch("/api/mcp/test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: form.url, transport: form.transport, command: form.command }),
    });
    const j = await r.json();
    toast(j.ok ? `Reachable — ${j.tools?.length || 0} tools` : j.error, j.ok ? "success" : "error");
  }
  async function restart(id: string) {
    const j = await (await fetch(`/api/mcp/servers/${id}/restart`, { method: "POST" })).json();
    toast(j.ok ? "Restarted" : j.error || "Failed", j.ok ? "success" : "error");
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    load();
  }
  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/mcp/servers/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Add a server manually</p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="sse">HTTP SSE</option>
            <option value="stdio">stdio</option>
            <option value="ws">WebSocket</option>
          </select>
          {form.transport === "stdio" ? (
            <Input placeholder="Command (e.g. npx -y server-x)" value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })} />
          ) : (
            <Input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          )}
          <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="allow">Always Allow</option>
            <option value="ask">Ask First</option>
            <option value="pin">Never Without PIN</option>
          </select>
        </div>
        <Input placeholder="Description" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={test}>Test connection</Button>
          <Button size="sm" onClick={add}>Add server</Button>
        </div>
      </Card>

      {servers.length === 0 ? (
        <EmptyState title="No MCP servers connected"
          hint="Add a server above, or browse the Registry Browser tab for one-click installs." />
      ) : (
        servers.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{s.name}</span>
              <Badge variant={s.health?.status === "connected" ? "success" : s.health?.status === "error" ? "destructive" : "outline"}>
                {s.health?.status || "disconnected"}
              </Badge>
              <span className="text-xs text-muted-foreground">{s.tools?.length || 0} tools · {s.source}</span>
              <button className="ml-auto text-xs underline" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                {expanded === s.id ? "hide" : "tools"}
              </button>
              <Button size="sm" variant="outline" onClick={() => restart(s.id)}>Restart</Button>
              <Button size="sm" variant="outline" onClick={() => toggle(s.id, !s.enabled)}>
                {s.enabled ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>Remove</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              calls 24h: {s.health?.calls24h || 0} · errors: {s.health?.errors || 0} · avg {s.health?.avgMs || 0}ms
              {s.health?.lastError ? ` · last error: ${s.health.lastError}` : ""}
            </p>
            {expanded === s.id && (
              <div className="mt-2 space-y-1">
                {s.tools.map((t: any) => (
                  <div key={t.id} className="text-xs flex items-center gap-2 border rounded px-2 py-1">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground flex-1 truncate">{t.description}</span>
                    <Badge variant="outline">{t.tier}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

function ToolRegistryTab() {
  const [tools, setTools] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const load = () => fetch("/api/mcp/tools").then((r) => r.json()).then((j) => setTools(j.tools || []));
  useEffect(() => { load(); }, []);
  async function setTier(id: string, tier: string) {
    await fetch(`/api/mcp/tools/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier }),
    });
    load();
  }
  const visible = tools.filter((t) => !q || `${t.name} ${t.server_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <Input placeholder="Search tools…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
      {visible.length === 0 && <EmptyState title="No MCP tools registered" hint="Connect a server to populate the tool registry." />}
      {visible.map((t) => (
        <Card key={t.id} className="p-3 flex items-center gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.server_name}</span></p>
            <p className="text-xs text-muted-foreground">{t.description} · called {t.call_count}×</p>
          </div>
          <select value={t.tier} onChange={(e) => setTier(t.id, e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs">
            <option value="allow">Always Allow</option>
            <option value="ask">Ask First</option>
            <option value="pin">Never Without PIN</option>
          </select>
        </Card>
      ))}
    </div>
  );
}

function RegistryTab() {
  const [registry, setRegistry] = useState<any[]>([]);
  useEffect(() => { fetch("/api/mcp/registry").then((r) => r.json()).then((j) => setRegistry(j.registry || [])); }, []);
  async function install(id: string) {
    toast("Installing…");
    const j = await (await fetch("/api/mcp/registry", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
    })).json();
    toast(j.connected ? "Installed and connected" : j.error || "Installed (not connected)", j.connected ? "success" : "error");
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {registry.map((e) => (
        <Card key={e.id} className="p-3">
          <p className="font-medium text-sm">{e.name} <span className="text-xs text-muted-foreground">v{e.version}</span></p>
          <p className="text-xs text-muted-foreground">{e.description}</p>
          <p className="text-xs text-muted-foreground mt-1">Tools: {e.tools.join(", ")}</p>
          <p className="text-xs text-muted-foreground">Permissions: {e.permissions} · {e.author}</p>
          <Button size="sm" className="mt-2" onClick={() => install(e.id)}>Install</Button>
        </Card>
      ))}
    </div>
  );
}

function BuilderTab() {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tools, setTools] = useState<any[]>([]);
  const [code, setCode] = useState("");

  function addTool() {
    setTools([...tools, {
      name: "", description: "", params: [],
      execution: { type: "http", method: "GET", url: "" },
    }]);
  }
  function update(i: number, patch: any) {
    setTools(tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  async function preview() {
    const j = await (await fetch("/api/mcp/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "preview", server: { name, description: desc, tools } }),
    })).json();
    setCode(j.code || j.error || "");
  }
  async function build() {
    const j = await (await fetch("/api/mcp/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "build", server: { name, description: desc, tools } }),
    })).json();
    toast(j.server ? "Server built and connected" : j.error || "Build failed", j.server ? "success" : "error");
  }

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-2">
        <Input placeholder="Server name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        {tools.map((t, i) => (
          <div key={i} className="border rounded p-2 space-y-1">
            <Input placeholder="Tool name" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input placeholder="Tool description" value={t.description} onChange={(e) => update(i, { description: e.target.value })} />
            <select value={t.execution.type}
              onChange={(e) => update(i, { execution: { type: e.target.value, method: "GET", url: "", command: "", code: "" } })}
              className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value="http">HTTP request</option>
              <option value="shell">Shell command</option>
              <option value="js">JavaScript function</option>
            </select>
            {t.execution.type === "http" && (
              <Input placeholder="URL (use {param} placeholders)" value={t.execution.url}
                onChange={(e) => update(i, { execution: { ...t.execution, url: e.target.value } })} />
            )}
            {t.execution.type === "shell" && (
              <Input placeholder="Command (use {param} placeholders)" value={t.execution.command || ""}
                onChange={(e) => update(i, { execution: { ...t.execution, command: e.target.value } })} />
            )}
            {t.execution.type === "js" && (
              <textarea placeholder="return ..." value={t.execution.code || ""}
                onChange={(e) => update(i, { execution: { ...t.execution, code: e.target.value } })}
                className="w-full rounded-md border bg-background px-2 py-1 text-xs h-20" />
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addTool}>+ Add tool</Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={preview}>Preview code</Button>
          <Button size="sm" onClick={build} disabled={!name || tools.length === 0}>Build & connect</Button>
        </div>
      </Card>
      {code && <pre className="text-xs bg-muted/40 rounded p-3 overflow-x-auto">{code}</pre>}
    </div>
  );
}
