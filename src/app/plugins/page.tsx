"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { Package, Download, Trash2, RefreshCw, ShieldAlert, AlertTriangle } from "lucide-react";

type RegistryPlugin = {
  id: string;
  plugin_type: string;
  name: string;
  author: string;
  version: string;
  description: string;
  install_size_kb?: number;
  source_url?: string;
  permissions?: string[];
  network_domains?: string[];
};

type Installed = {
  plugin_id: string;
  plugin_type: string;
  name: string;
  version: string;
  source_url: string | null;
  installed_at: number;
  enabled: number;
  config_json: string;
};

const TYPE_LABELS: Record<string, string> = {
  "mcp-server": "MCP Server",
  "workflow-template": "Workflow",
  "system-prompt-template": "Persona",
  "agent-config": "Agent Config",
  "knowledge-dataset": "Knowledge Set",
};

export default function PluginsPage() {
  const confirm = useConfirm();
  const [registry, setRegistry] = useState<{ plugins: RegistryPlugin[]; source: string; fetched_at: number } | null>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RegistryPlugin | null>(null);
  const [filter, setFilter] = useState<string>("");

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([
      fetch("/api/plugins/registry").then((r) => r.json()),
      fetch("/api/plugins").then((r) => r.json()),
    ]);
    setRegistry(r);
    setInstalled(i.installed || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setBusy("refresh");
    try {
      const r = await fetch("/api/plugins/registry?refresh=1").then((r) => r.json());
      setRegistry(r);
      const i = await fetch("/api/plugins").then((r) => r.json());
      setInstalled(i.installed || []);
      toast("Registry refreshed", "success");
    } finally {
      setBusy(null);
    }
  }

  async function install(p: RegistryPlugin) {
    setBusy(`install:${p.id}`);
    try {
      const r = await fetch("/api/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registry_id: p.id }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast(j.error || "Install failed", "error");
        return;
      }
      toast(`Installed ${p.name}`, "success");
      setConfirming(null);
      load();
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(p: Installed) {
    const ok = await confirm({
      title: `Uninstall ${p.name}?`,
      message: "Any artefacts it created (workflows, personas) will be removed.",
      confirmLabel: "Uninstall",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`uninstall:${p.plugin_id}`);
    try {
      const r = await fetch(`/api/plugins/${p.plugin_id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Uninstall failed", "error"); return; }
      toast("Uninstalled", "success");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function update(p: Installed) {
    setBusy(`update:${p.plugin_id}`);
    try {
      const r = await fetch(`/api/plugins/${p.plugin_id}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Update failed", "error"); return; }
      toast(`Updated ${p.name}`, "success");
      load();
    } finally {
      setBusy(null);
    }
  }

  const installedByRegistryId = useMemo(() => {
    const map = new Map<string, Installed>();
    for (const inst of installed) {
      try {
        const cfg = JSON.parse(inst.config_json) as { registry_id?: string };
        if (cfg.registry_id) map.set(cfg.registry_id, inst);
      } catch { /* skip */ }
    }
    return map;
  }, [installed]);

  const visible = registry?.plugins.filter((p) =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.description.toLowerCase().includes(filter.toLowerCase())
  ) || [];

  return (
    <div className="mx-auto max-w-5xl px-10 py-14 space-y-6">
      <div className="flex items-end justify-between gap-6 mb-2">
        <div>
          <p className="lm-micro mb-2">Plugins</p>
          <h1 className="lm-display">Extend Sora</h1>
        </div>
        <input
          placeholder="Search plugins…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm w-56"
        />
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy === "refresh"}>
          <RefreshCw className="h-3.5 w-3.5" /> {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {registry && (
        <p className="text-xs text-muted-foreground">
          Registry source: {registry.source === "remote" ? "GitHub (live)" : registry.source === "cache" ? "cached" : "built-in catalogue"} ·
          {" "}fetched {new Date(registry.fetched_at).toLocaleString()}
        </p>
      )}

      {/* Installed */}
      {installed.length === 0 ? (
        <section>
          <h2 className="text-sm font-medium mb-2">Installed</h2>
          <Card className="p-4 text-sm text-muted-foreground">
            Nothing installed yet. Ask Sora to install an MCP (`install_mcp_server`), or pick a plugin below.
            Prefer MCP/plugins before an Ops Gate-2 coding proposal.
          </Card>
        </section>
      ) : (
        <section>
          <h2 className="text-sm font-medium mb-2">Installed ({installed.length})</h2>
          <div className="space-y-2">
            {installed.map((p) => (
              <Card key={p.plugin_id} className="p-3 flex items-center gap-3">
                <Badge variant="outline">{TYPE_LABELS[p.plugin_type] || p.plugin_type}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{p.name}</p>
                  <p className="text-xs text-muted-foreground">v{p.version} · installed {new Date(p.installed_at).toLocaleDateString()}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => update(p)} disabled={busy === `update:${p.plugin_id}`}>
                  Update
                </Button>
                <Button size="sm" variant="ghost" onClick={() => uninstall(p)} disabled={busy === `uninstall:${p.plugin_id}`}>
                  <Trash2 className="h-3.5 w-3.5" /> Uninstall
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {installed.length === 0 && (!registry || (registry.plugins || []).length === 0) && (
        <Card className="p-4 text-sm text-muted-foreground space-y-2">
          <p>No plugins in the registry either.</p>
          <p>
            Ask Sora to install an MCP with <code className="text-xs">install_mcp_server</code>, or file an Ops
            improvement proposal so a coding PR can add the capability.
          </p>
        </Card>
      )}

      {/* Available */}
      <section>
        <h2 className="text-sm font-medium mb-2">Available</h2>
        {!registry ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No plugins match your search. Ask Sora to install an MCP (`install_mcp_server`) or browse the registry — prefer plugins/MCP before filing an Ops self-improve proposal.
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {visible.map((p) => {
              const inst = installedByRegistryId.get(p.id);
              return (
                <Card key={p.id} className="p-3">
                  <div className="flex items-start gap-2 mb-1">
                    <Badge variant="outline">{TYPE_LABELS[p.plugin_type] || p.plugin_type}</Badge>
                    <p className="font-medium text-sm flex-1">{p.name}</p>
                    <span className="text-xs text-muted-foreground">v{p.version}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{p.description}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">by {p.author}</span>
                    {inst ? (
                      <Badge variant="success">Installed</Badge>
                    ) : (
                      <Button size="sm" onClick={() => setConfirming(p)} disabled={!!busy}>
                        <Download className="h-3 w-3" /> Install
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Install confirmation modal */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setConfirming(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-4 py-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <p className="font-medium text-sm flex-1">Install {confirming.name}?</p>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p>{confirming.description}</p>
              <div>
                <p className="font-medium text-xs mb-1">Type</p>
                <Badge variant="outline">{TYPE_LABELS[confirming.plugin_type] || confirming.plugin_type}</Badge>
              </div>
              {confirming.permissions && confirming.permissions.length > 0 && (
                <div>
                  <p className="font-medium text-xs mb-1">Permissions it expects</p>
                  <div className="flex flex-wrap gap-1">
                    {confirming.permissions.map((perm) => (
                      <Badge key={perm} variant="warning">{perm}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Installing only adds the workflow or persona — actual permission tiers are still controlled from the Permissions Board.
                  </p>
                </div>
              )}
              {confirming.network_domains && confirming.network_domains.length > 0 && (
                <div>
                  <p className="font-medium text-xs mb-1">Network domains</p>
                  <ul className="text-xs text-muted-foreground">
                    {confirming.network_domains.map((d) => <li key={d}>· {d}</li>)}
                  </ul>
                </div>
              )}
              {confirming.plugin_type === "mcp-server" && (() => {
                const launch = (confirming as any).payload as
                  | { source?: string; package?: string; command?: string }
                  | undefined;
                if (launch && launch.source) {
                  const preview =
                    launch.source === "npm"    ? `npx -y ${launch.package}` :
                    launch.source === "pipx"   ? `pipx run ${launch.package}` :
                    launch.source === "uvx"    ? `uvx ${launch.package}` :
                    launch.source === "docker" ? `docker run --rm -i ${launch.package}` :
                    launch.command || "(manual)";
                  return (
                    <div className="rounded border bg-muted/40 p-2 text-xs space-y-1">
                      <p className="font-medium">Launch command (runs as a separate child process)</p>
                      <code className="text-[11px] block">{preview}</code>
                      <p className="text-muted-foreground">
                        Process isolation comes from running as its own stdio child; outbound network is restricted to the allowlist above.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                    <p>
                      No launch metadata in the registry entry — add this server manually from MCP Servers → Add server.
                    </p>
                  </div>
                );
              })()}
            </div>
            <div className="border-t px-4 py-3 flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => install(confirming)}
                disabled={
                  busy === `install:${confirming.id}` ||
                  (confirming.plugin_type === "mcp-server" && !((confirming as any).payload?.source))
                }
              >
                {busy === `install:${confirming.id}` ? "Installing…" : "Install"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
