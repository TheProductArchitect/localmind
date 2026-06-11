"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Input, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import {
  RefreshCw, ExternalLink, CheckCircle2, AlertCircle,
} from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsSectionId, type HiddenSectionId } from "@/components/settings-sidebar";

// Tools is reachable via ?section=Tools but doesn't appear in the in-page
// tab list — it's surfaced under "Context engineering" in the sidebar.
type SectionId = SettingsSectionId | HiddenSectionId;
const ALL_SECTION_IDS = [...SETTINGS_SECTIONS.map((s) => s.id), "Tools"] as const;

function SettingsBody() {
  const params = useSearchParams();
  const raw = params.get("section");
  const section: SectionId = (
    (ALL_SECTION_IDS as readonly string[]).includes(raw ?? "")
      ? (raw as SectionId)
      : "General"
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-10 py-14">
        <p className="lm-micro mb-2">{section}</p>
        <h1 className="lm-display mb-10">{sectionTitle(section)}</h1>
        {section === "General"        && <GeneralSection />}
        {section === "Tools"          && <ToolsSection />}
          {section === "Network"        && <NetworkSection />}
          {section === "Providers"      && <ProvidersSection />}
          {section === "Communications" && <CommsSection />}
          {section === "Integrations"   && <IntegrationsSection />}
          {section === "Data & Privacy" && <DataSection />}
          {section === "Backup"         && <BackupSection />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  // useSearchParams must live inside a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SettingsBody />
    </Suspense>
  );
}

function sectionTitle(id: SectionId): string {
  return {
    "General":        "How Sora behaves",
    "Tools":          "What Sora is allowed to do",
    "Network":        "Where Sora can be reached",
    "Providers":      "External model providers",
    "Communications": "Channels and notifications",
    "Integrations":   "Open source you're standing on",
    "Data & Privacy": "Your data, your rules",
    "Backup":         "Save and restore",
  }[id];
}

/* ============================================================ */
/* Integrations                                                 */
/* ============================================================ */

type OssEntry = {
  name: string;
  purpose: string;
  license: string;
  repo: string;
  source: "system" | "npm";
  version?: string;
  detected?: boolean;
  latest?: string;
  outdated?: boolean;
};
type IntegrationsResp = {
  system: OssEntry[];
  npm: OssEntry[];
  summary: {
    total: number;
    detected: number;
    outdated_count: number;
    checked_for_updates: boolean;
    checked_at: number | null;
  };
};

function IntegrationsSection() {
  const [data, setData] = useState<IntegrationsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  async function load(check = false) {
    if (check) setChecking(true);
    else setLoading(true);
    try {
      const r = await fetch(`/api/integrations${check ? "?check=1" : ""}`);
      const j = (await r.json()) as IntegrationsResp;
      setData(j);
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }
  useEffect(() => { load(false); }, []);

  if (loading) {
    return <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card className="p-4 flex items-center gap-4">
        <div className="flex-1">
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.92)", fontWeight: 500 }}>
            {data.summary.detected} of {data.summary.total} integrations detected on this machine
          </p>
          <p className="lm-micro mt-1" style={{ textTransform: "none", letterSpacing: 0 }}>
            {data.summary.checked_for_updates
              ? data.summary.outdated_count > 0
                ? `${data.summary.outdated_count} library can be updated`.replace("1 library can", "1 library can").replace(/^(\d+) library/, (m, n) => Number(n) === 1 ? `${n} library` : `${n} libraries`)
                : "Everything is up to date."
              : "Click below to check for available updates."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load(true)} disabled={checking}>
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "Check for updates"}
        </Button>
      </Card>

      <IntegrationGroup
        title="System tools"
        hint="Installed alongside LocalMind by the install script (or your package manager)."
        entries={data.system}
      />
      <IntegrationGroup
        title="npm libraries"
        hint="Load-bearing dependencies. Run `npm install` to apply available updates after reviewing."
        entries={data.npm}
        showUpdates
      />
    </div>
  );
}

function IntegrationGroup({
  title, hint, entries, showUpdates,
}: { title: string; hint: string; entries: OssEntry[]; showUpdates?: boolean }) {
  return (
    <section>
      <div className="mb-3">
        <p className="lm-micro">{title}</p>
        <p className="lm-micro mt-1" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.55)" }}>
          {hint}
        </p>
      </div>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.name} className="lm-int">
            <div className="lm-int__main">
              <div className="flex items-center gap-2">
                <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500 }}>{e.name}</p>
                {e.detected ? (
                  <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.5)" }} aria-label="Detected" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" style={{ color: "hsl(40 100% 70% / 0.7)" }} aria-label="Not detected" />
                )}
                {showUpdates && e.outdated && <Badge variant="warning">update available</Badge>}
              </div>
              <p className="lm-micro mt-1" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.55)" }}>
                {e.purpose}
              </p>
            </div>
            <div className="lm-int__meta">
              <span className="lm-chip" style={{ fontFamily: "ui-monospace,monospace" }}>
                {e.version || "—"}{e.outdated && e.latest ? ` → ${e.latest}` : ""}
              </span>
              <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>{e.license}</span>
              <a href={e.repo} target="_blank" rel="noreferrer noopener" className="lm-int__repo" data-pulse="true">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function useSettings() {
  const [s, setS] = useState<any>(null);
  const load = () => fetch("/api/settings").then((r) => r.json()).then((j) => setS(j.settings));
  useEffect(() => { load(); }, []);
  const save = async (patch: any) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    toast("Saved", "success");
    load();
  };
  return { s, save };
}

function GeneralSection() {
  const { s, save } = useSettings();
  const [memory, setMemory] = useState<any[]>([]);
  const [pin, setPin] = useState("");
  useEffect(() => { fetch("/api/memory").then((r) => r.json()).then((j) => setMemory(j.memory || [])); }, []);
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <p className="lm-micro">Agent mode</p>
        <p className="text-[12px]" style={{ color: "hsl(0 0% 100% / 0.6)" }}>
          How much Sora may do without asking. Memory reads are always allowed — she owns what she&apos;s remembered about you.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: "auto",  label: "Auto",   hint: "Trust Sora fully. Every action runs through." },
            { id: "plan",  label: "Plan",   hint: "Read-only. Mutations require leaving plan mode." },
            { id: "ask",   label: "Ask",    hint: "Default. Reads free, mutations confirmed." },
          ] as const).map((m) => {
            const active = (s.agent_mode || "ask") === m.id;
            return (
              <button
                key={m.id}
                onClick={() => save({ agent_mode: m.id })}
                className="lm-mode-tile"
                data-active={active}
                data-pulse="true"
              >
                <span className="lm-body" style={{ color: active ? "hsl(0 0% 100%)" : "hsl(0 0% 100% / 0.7)", fontWeight: 500 }}>
                  {m.label}
                </span>
                <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11, color: "hsl(0 0% 100% / 0.45)" }}>
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>
        <style jsx>{`
          .lm-mode-tile {
            display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
            padding: 12px 14px;
            background: hsl(0 0% 100% / 0.03);
            border: 1px solid hsl(0 0% 100% / 0.08);
            border-radius: 12px;
            text-align: left;
            transition: background var(--lm-dur-micro) var(--lm-ease-micro),
                        border-color var(--lm-dur-micro) var(--lm-ease-micro),
                        box-shadow var(--lm-dur-micro) var(--lm-ease-micro);
          }
          .lm-mode-tile:hover { background: hsl(0 0% 100% / 0.05); }
          .lm-mode-tile[data-active="true"] {
            background: hsl(0 0% 100% / 0.08);
            border-color: hsl(0 0% 100% / 0.22);
            box-shadow: 0 0 24px hsl(0 0% 100% / 0.12);
          }
        `}</style>
      </Card>
      <Card className="p-4 space-y-3">
        <label className="block text-sm">Assistant name
          <Input defaultValue={s.assistant_name} onBlur={(e) => save({ assistant_name: e.target.value })} className="mt-1" />
        </label>
        <label className="block text-sm">Personality
          <select defaultValue={s.personality} onChange={(e) => save({ personality: e.target.value })}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option>Professional</option><option>Friendly</option><option>Concise</option>
          </select>
        </label>
        <label className="block text-sm">Theme
          <select defaultValue={s.theme} onChange={(e) => save({ theme: e.target.value })}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
          </select>
        </label>
        <label className="block text-sm">Chat font size
          <Input type="number" defaultValue={s.chat_font_size}
            onBlur={(e) => save({ chat_font_size: Number(e.target.value) })} className="mt-1 w-24" />
        </label>
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Model context window</p>
        <p className="text-xs text-muted-foreground">
          How much conversation and code the model can consider at once. Larger windows suit big
          local coding models (e.g. 70B Qwen/DeepSeek) but use more memory. This size is sent to
          the local model server so the model actually loads with it. Auto picks a size based on
          the model name.
        </p>
        <select defaultValue={s.context_window}
          onChange={(e) => save({ context_window: Number(e.target.value) })}
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value={0}>Auto (based on model)</option>
          <option value={8192}>8K tokens</option>
          <option value={16384}>16K tokens</option>
          <option value={32768}>32K tokens</option>
          <option value={65536}>64K tokens</option>
          <option value={131072}>128K tokens</option>
        </select>
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Approved folders</p>
        <p className="text-xs text-muted-foreground">The filesystem tool can only touch paths inside these directories.</p>
        <Input defaultValue={JSON.parse(s.approved_dirs || "[]").join(", ")}
          placeholder="/Users/you/Documents, /Users/you/Desktop"
          onBlur={(e) => save({ approved_dirs: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Security PIN</p>
        <p className="text-xs text-muted-foreground">
          {s.pin_set ? "A PIN is set — it protects PIN-tier actions." : "No PIN set. The AI can take any permitted action without confirmation."}
        </p>
        <div className="flex gap-2">
          <Input type="password" placeholder="New 4+ digit PIN" value={pin}
            onChange={(e) => setPin(e.target.value)} className="w-48" />
          <Button size="sm" disabled={pin.length < 4} onClick={() => { save({ pin }); setPin(""); }}>Set PIN</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Memory</p>
        {memory.length === 0 && <p className="text-xs text-muted-foreground">No facts stored yet.</p>}
        {memory.map((m) => (
          <div key={m.id} className="flex items-center gap-2 text-sm border rounded px-2 py-1.5">
            <span className="font-medium">{m.key}</span>
            <span className="text-muted-foreground truncate flex-1">{m.value}</span>
            <Button size="sm" variant="ghost"
              onClick={async () => { await fetch(`/api/memory/${m.id}`, { method: "DELETE" }); setMemory((x) => x.filter((i) => i.id !== m.id)); }}>
              Forget
            </Button>
          </div>
        ))}
      </Card>

      <AlwaysOnCard />
    </div>
  );
}

function AlwaysOnCard() {
  type Plan = {
    platform: "macos" | "linux" | "unsupported";
    service_path?: string;
    contents?: string;
    activate_commands?: string[];
    deactivate_commands?: string[];
    reason?: string;
  };
  const [plan, setPlan] = useState<Plan | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCommands, setShowCommands] = useState(false);

  async function load() {
    const j = await (await fetch("/api/system/always-on")).json();
    setPlan(j.plan);
    setInstalled(!!j.installed);
  }
  useEffect(() => { load(); }, []);

  async function install() {
    setBusy(true);
    const r = await fetch("/api/system/always-on", { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) toast(j.error || "Could not write the service file.", "error");
    else { toast("Service file written. Run the activate commands to start.", "success"); setShowCommands(true); }
    load();
  }
  async function uninstall() {
    setBusy(true);
    await fetch("/api/system/always-on", { method: "DELETE" });
    setBusy(false);
    toast("Service file removed. Run the deactivate commands to fully stop.", "success");
    load();
  }

  if (!plan) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="lm-micro">Run LocalMind always</p>
        {installed && <Badge variant="success">installed</Badge>}
      </div>
      <p className="text-[12px]" style={{ color: "hsl(0 0% 100% / 0.6)" }}>
        Keep the server alive across logout and sleep so scheduled tasks, monitors, and peer chats land on
        time. The app idles when nothing is happening — no busy loop, just a quiet check-in once a minute.
      </p>

      {plan.platform === "unsupported" ? (
        <p className="text-xs text-amber-500">{plan.reason}</p>
      ) : (
        <>
          <div className="text-[11px] font-mono text-muted-foreground break-all">
            {plan.service_path}
          </div>
          <div className="flex items-center gap-2">
            {!installed ? (
              <Button size="sm" onClick={install} disabled={busy}>Install</Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setShowCommands((s) => !s)}>
                  {showCommands ? "Hide" : "Show"} commands
                </Button>
                <Button size="sm" variant="ghost" onClick={uninstall} disabled={busy}>Remove</Button>
              </>
            )}
          </div>
          {(showCommands || !installed) && (
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground">
                Run these in your terminal to {installed ? "activate" : "complete activation"}:
              </p>
              {plan.activate_commands?.map((c, i) => (
                <pre key={i} className="text-[10px] font-mono bg-muted p-1.5 rounded overflow-x-auto">{c}</pre>
              ))}
              <p className="text-[11px] text-muted-foreground pt-2">To uninstall later:</p>
              {plan.deactivate_commands?.map((c, i) => (
                <pre key={i} className="text-[10px] font-mono bg-muted p-1.5 rounded overflow-x-auto">{c}</pre>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function NetworkSection() {
  const { s, save } = useSettings();
  const [ip, setIp] = useState("");
  useEffect(() => {
    fetch("/api/system/health").then(() => {});
    setIp(window.location.hostname);
  }, []);
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Network</h1>
      <Card className="p-4 space-y-3">
        <label className="flex items-center justify-between text-sm">
          Local network access (LAN)
          <input type="checkbox" defaultChecked={!!s.lan_enabled}
            onChange={(e) => save({ lan_enabled: e.target.checked ? 1 : 0 })} />
        </label>
        {!!s.lan_enabled && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-500 p-2 text-xs">
            Warning: any device on your network can access LocalMind. A restart is required for this to take effect.
          </div>
        )}
        <label className="block text-sm">Custom port
          <Input type="number" defaultValue={s.port} onBlur={(e) => save({ port: Number(e.target.value) })} className="mt-1 w-28" />
        </label>
        <label className="flex items-center justify-between text-sm">
          HTTPS (self-signed certificate for LAN)
          <input type="checkbox" defaultChecked={!!s.https_enabled}
            onChange={(e) => save({ https_enabled: e.target.checked ? 1 : 0 })} />
        </label>
        <p className="text-xs text-muted-foreground">
          Access from other devices: <code>http://{ip}:{s.port}</code>
        </p>
      </Card>
    </div>
  );
}

function ProvidersSection() {
  const [providers, setProviders] = useState<{ name: string; connected: boolean }[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const load = () => fetch("/api/providers").then((r) => r.json()).then((j) => setProviders(j.providers));
  useEffect(() => { load(); }, []);

  async function action(provider: string, act: string) {
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, action: act, key: keys[provider] }),
    });
    const j = await r.json();
    if (act === "test") toast(j.ok ? `${provider}: connection OK` : `${provider}: ${j.error}`, j.ok ? "success" : "error");
    else toast(j.ok ? "Saved" : j.error || "Failed", j.ok ? "success" : "error");
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Providers & API Keys</h1>
      <p className="text-xs text-muted-foreground">Keys are encrypted with AES-256-GCM at rest.</p>
      {providers.map((p) => (
        <Card key={p.name} className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm capitalize">{p.name}</span>
            {p.connected && <Badge variant="success">Connected</Badge>}
          </div>
          {p.name === "ollama" ? (
            <p className="text-xs text-muted-foreground">Local runtime — no API key needed.</p>
          ) : (
            <div className="flex gap-2">
              <Input type="password" placeholder="API key"
                onChange={(e) => setKeys((k) => ({ ...k, [p.name]: e.target.value }))} />
              <Button size="sm" onClick={() => action(p.name, "save")}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => action(p.name, "test")}>Test</Button>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={async () => {
            await fetch("/api/settings", {
              method: "PATCH", headers: { "content-type": "application/json" },
              body: JSON.stringify({ provider: p.name }),
            });
            toast(`${p.name} set as active provider`, "success");
          }}>Set as active</Button>
        </Card>
      ))}
    </div>
  );
}

function McpSection() {
  const [servers, setServers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", url: "", description: "", tier: "ask" });
  const load = () => fetch("/api/mcp").then((r) => r.json()).then((j) => setServers(j.servers || []));
  useEffect(() => { load(); }, []);

  async function test() {
    const r = await fetch("/api/mcp/test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: form.url }),
    });
    const j = await r.json();
    toast(j.ok ? `Reachable — tools: ${j.tools?.join(", ") || "none"}` : j.error, j.ok ? "success" : "error");
  }
  async function add() {
    if (!form.name || !form.url) return;
    await fetch("/api/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", url: "", description: "", tier: "ask" });
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/mcp?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">MCP Servers</h1>
      <p className="text-xs text-muted-foreground">
        Add custom Model Context Protocol servers. Their tools go through the same audit log and
        permission guard as built-in tools.
      </p>
      <Card className="p-4 space-y-2">
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="URL (SSE endpoint)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <Input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="allow">Always Allow</option>
          <option value="ask">Ask First</option>
          <option value="pin">Never Without PIN</option>
        </select>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={test}>Test connection</Button>
          <Button size="sm" onClick={add}>Add server</Button>
        </div>
      </Card>
      {servers.map((s) => (
        <Card key={s.id} className="p-3 flex items-center gap-2">
          <div className="flex-1">
            <p className="font-medium text-sm">{s.name}</p>
            <p className="text-xs text-muted-foreground">{s.url} · tier: {s.tier}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>Remove</Button>
        </Card>
      ))}
    </div>
  );
}

type ToolRow = { name: string; description: string; action_type: string };
type McpServerRow = {
  id: string; name: string; description: string | null;
  enabled: number; transport: string; source: string;
  command: string | null; url: string;
};

const MAC_TOOL_IDS: Record<string, string> = {
  calendar: "Calendar",
  email: "Mail",
  mac_automation: "Mac automation",
};
// Tools whose action_type lives in the destructive floor — their tier can
// be 'ask' or 'pin' but never 'allow'. This mirrors permission-guard.ts.
const FLOOR_ACTIONS = new Set([
  "delete_files", "delete_data", "drop_table", "destructive_shell", "uninstall",
  "factory_reset", "revoke_session", "delete_user", "unpair_peer",
  "delete_conversation", "delete_memory", "delete_knowledge", "delete_automation",
  "send_email", "make_call", "post_message", "git_force_push", "git_reset_hard",
  "install_mcp",
]);

function ToolsSection() {
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Record<string, "allow" | "ask" | "pin">>({});
  const [verifyStatus, setVerifyStatus] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      const [t, perms, m] = await Promise.all([
        fetch("/api/tools").then((r) => r.json()).catch(() => ({ tools: [] })),
        fetch("/api/permissions").then((r) => r.json()).catch(() => ({ profiles: [], active: null })),
        fetch("/api/mcp/servers").then((r) => r.json()).catch(() => ({ servers: [] })),
      ]);
      setTools((t.tools as ToolRow[]) || []);
      setServers((m.servers as McpServerRow[]) || []);
      const active = (perms.profiles || []).find((p: any) => p.id === perms.active) || perms.profiles?.[0];
      if (active) {
        setProfileId(active.id);
        setTiers(active.tiers || {});
      }
    })();
  }, []);

  async function setTier(actionType: string, next: "allow" | "ask" | "pin") {
    if (!profileId) return;
    // Honour the floor even at the UI: never let the user set 'allow' on a
    // destructive action. The classifier in permission-guard.ts ignores it
    // anyway, but stopping it here avoids confusion.
    const safe = FLOOR_ACTIONS.has(actionType) && next === "allow" ? "ask" : next;
    const updated = { ...tiers, [actionType]: safe };
    setTiers(updated);
    await fetch("/api/permissions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: profileId, tiers: updated }),
    });
  }

  async function setMcpEnabled(id: string, enabled: boolean) {
    setServers((arr) => arr.map((s) => (s.id === id ? { ...s, enabled: enabled ? 1 : 0 } : s)));
    await fetch(`/api/mcp/servers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function verifyMac(tool: string) {
    setVerifyStatus((s) => ({ ...s, [tool]: { checking: true } }));
    const j = await (await fetch("/api/tools/verify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool }),
    })).json();
    setVerifyStatus((s) => ({ ...s, [tool]: j }));
  }

  const q = filter.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  // Separate built-ins from MCP-server-backed tools. MCP tools have names
  // prefixed `mcp:` by the registry, so we can split cleanly.
  const builtins = tools.filter((t) => !t.name.startsWith("mcp:") && (matches(t.name) || matches(t.description)));
  const mcpTools = tools.filter((t) => t.name.startsWith("mcp:") && (matches(t.name) || matches(t.description)));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground mb-3">
          Every tool Sora can call. The dropdown controls the default approval tier; destructive
          tools are pinned to <span className="font-mono">ask</span> or <span className="font-mono">pin</span> and
          cannot be set to <span className="font-mono">allow</span> regardless of mode.
        </p>
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Built-in tools */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Built-in</p>
        {builtins.length === 0 && (
          <p className="text-xs text-muted-foreground">No tools match.</p>
        )}
        {builtins.map((t) => {
          const tier = tiers[t.action_type] || "ask";
          const isFloor = FLOOR_ACTIONS.has(t.action_type);
          const macKey = Object.keys(MAC_TOOL_IDS).find((k) => t.name === k);
          const st = macKey ? verifyStatus[macKey] : null;
          return (
            <Card key={t.name} className="p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{t.name}</span>
                    {isFloor && <Badge variant="warning">destructive</Badge>}
                    {macKey && st?.verified && <Badge variant="success">verified</Badge>}
                    {macKey && st?.verified === false && <Badge variant="warning">denied</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">action: {t.action_type}</p>
                </div>
                <select
                  value={tier}
                  onChange={(e) => setTier(t.action_type, e.target.value as any)}
                  className="text-xs border rounded px-2 py-1 bg-transparent"
                  aria-label={`Permission tier for ${t.name}`}
                >
                  <option value="ask">ask</option>
                  <option value="pin">pin</option>
                  {!isFloor && <option value="allow">allow</option>}
                </select>
                {macKey && (
                  <Button size="sm" variant="outline" onClick={() => verifyMac(macKey)}>
                    {st?.checking ? "…" : "Verify"}
                  </Button>
                )}
              </div>
              {macKey && st?.verified === false && (
                <a href={st.settingsPane} className="text-xs underline text-amber-600 mt-2 inline-block">
                  Open System Settings to grant access
                </a>
              )}
            </Card>
          );
        })}
      </div>

      {/* MCP servers — show each server then the tools it provides */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MCP servers</p>
          <a href="/mcp" className="text-xs underline text-muted-foreground">Manage servers ↗</a>
        </div>
        {servers.length === 0 && (
          <p className="text-xs text-muted-foreground">No MCP servers installed yet. Ask Sora to install one (e.g. &ldquo;install the GitHub MCP via npm&rdquo;) — she&apos;ll prompt you to approve before it&apos;s registered.</p>
        )}
        {servers.filter((s) => matches(s.name) || matches(s.description ?? "")).map((s) => {
          const childTools = mcpTools.filter((t) => t.name === `mcp:${s.name}` || t.name.startsWith(`mcp:${s.name}:`));
          return (
            <Card key={s.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{s.name}</p>
                    <Badge variant={s.enabled ? "success" : "warning"}>
                      {s.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">{s.source}</span>
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground mt-1">{s.description}</p>}
                  {s.command && (
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                      $ {s.command}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMcpEnabled(s.id, !s.enabled)}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
              {childTools.length > 0 && (
                <div className="mt-2 pl-3 border-l border-border space-y-1">
                  {childTools.map((t) => (
                    <p key={t.name} className="text-[11px] font-mono text-muted-foreground">
                      • {t.name.replace(/^mcp:/, "")}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TwilioWizard() {
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [inbound, setInbound] = useState<string | null>(null);

  async function verify() {
    setBusy("verify");
    const j = await (await fetch("/api/comms/twilio", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify" }),
    })).json();
    toast(j.ok ? "Twilio credentials verified" : j.error || "Verification failed", j.ok ? "success" : "error");
    setBusy("");
  }
  async function tunnel() {
    setBusy("tunnel");
    const j = await (await fetch("/api/comms/tunnel", { method: "POST" })).json();
    if (j.ok) { setTunnelUrl(j.url); toast("Tunnel started", "success"); }
    else toast(j.error || "Tunnel failed", "error");
    setBusy("");
  }
  async function test(kind: "test-sms" | "test-call") {
    setBusy(kind);
    setInbound(null);
    const j = await (await fetch("/api/comms/twilio", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: kind }),
    })).json();
    if (!j.ok) { toast(j.error || "Test failed", "error"); setBusy(""); return; }
    toast(kind === "test-sms" ? "Test SMS sent — reply to verify" : "Test call placed", "success");
    if (kind === "test-sms") {
      // Poll for an inbound reply for up to 60s.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const last = (await (await fetch("/api/comms/twilio?inbound=sms")).json()).last;
        if (last && Date.now() - last.at < 90000) { setInbound(last.body); break; }
      }
    }
    setBusy("");
  }

  return (
    <div className="border-t pt-2 mt-2 space-y-2">
      <p className="text-xs font-medium">Setup wizard</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={verify}>
          {busy === "verify" ? "Checking…" : "1. Verify credentials"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={tunnel}>
          {busy === "tunnel" ? "Connecting to Cloudflare…" : "2. Start tunnel"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => test("test-sms")}>
          {busy === "test-sms" ? "Waiting for reply…" : "3. Send test SMS"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => test("test-call")}>
          4. Test call
        </Button>
      </div>
      {tunnelUrl && (
        <div className="text-xs space-y-1">
          <p className="text-muted-foreground">Paste these into the Twilio console:</p>
          <p>SMS webhook: <code>{tunnelUrl}/api/channels/twilio/sms</code></p>
          <p>Voice webhook: <code>{tunnelUrl}/api/channels/twilio/voice</code></p>
        </div>
      )}
      {inbound && (
        <p className="text-xs text-green-600">Inbound reply received: “{inbound}” — SMS verified ✓</p>
      )}
      <p className="text-xs text-muted-foreground">
        WhatsApp uses the same Twilio number via the WhatsApp Sandbox — join the sandbox from your
        phone, then test with the SMS flow above. Sandbox mode requires re-joining monthly.
      </p>
    </div>
  );
}

function CommsSection() {
  const [telegram, setTelegram] = useState({ enabled: false, botToken: "", defaultChatId: "" });
  const [twilio, setTwilio] = useState({ enabled: false, accountSid: "", authToken: "", authorisedNumber: "", publicUrl: "" });
  // WhatsApp piggybacks on Twilio's WhatsApp API — same SID/auth, but a
  // separate enable flag + WhatsApp-from number and per-channel webhook URL.
  // Storing the config in its own channel row lets us wire Twilio's two
  // independent webhooks (SMS vs WhatsApp) without conflating them.
  const [whatsapp, setWhatsapp] = useState({ enabled: false, fromNumber: "", authorisedNumber: "" });
  const [apiToken, setApiToken] = useState("");

  useEffect(() => {
    fetch("/api/channels?type=telegram").then((r) => r.json()).then((j) =>
      setTelegram({ enabled: j.enabled, botToken: j.config?.botToken || "", defaultChatId: j.config?.defaultChatId || "" }));
    fetch("/api/channels?type=twilio").then((r) => r.json()).then((j) =>
      setTwilio({ enabled: j.enabled, accountSid: j.config?.accountSid || "", authToken: j.config?.authToken || "",
        authorisedNumber: j.config?.authorisedNumber || "", publicUrl: j.config?.publicUrl || "" }));
    fetch("/api/channels?type=whatsapp").then((r) => r.json()).then((j) =>
      setWhatsapp({ enabled: j.enabled, fromNumber: j.config?.fromNumber || "", authorisedNumber: j.config?.authorisedNumber || "" }));
  }, []);

  async function saveChannel(type: string, enabled: boolean, config: any) {
    await fetch("/api/channels", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, enabled, config }),
    });
    toast("Channel saved", "success");
  }
  async function genToken() {
    const j = await (await fetch("/api/settings/api-token", { method: "POST" })).json();
    setApiToken(j.token);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Communications</h1>
      <p className="text-xs text-muted-foreground">
        Channels carry messages to your Mac for local processing. Only message-in-transit passes
        through a relay (Telegram, Twilio); nothing is stored in the cloud.
      </p>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm flex-1">Telegram</p>
          <input type="checkbox" checked={telegram.enabled}
            onChange={(e) => setTelegram({ ...telegram, enabled: e.target.checked })} />
        </div>
        <Input placeholder="Bot token (from BotFather)" value={telegram.botToken}
          onChange={(e) => setTelegram({ ...telegram, botToken: e.target.value })} />
        <Input placeholder="Default chat ID (for proactive messages)" value={telegram.defaultChatId}
          onChange={(e) => setTelegram({ ...telegram, defaultChatId: e.target.value })} />
        <Button size="sm" onClick={() => saveChannel("telegram", telegram.enabled,
          { botToken: telegram.botToken, defaultChatId: telegram.defaultChatId })}>Save Telegram</Button>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm flex-1">Twilio (SMS &amp; voice calls)</p>
          <input type="checkbox" checked={twilio.enabled}
            onChange={(e) => setTwilio({ ...twilio, enabled: e.target.checked })} />
        </div>
        <Input placeholder="Account SID" value={twilio.accountSid}
          onChange={(e) => setTwilio({ ...twilio, accountSid: e.target.value })} />
        <Input placeholder="Auth token" value={twilio.authToken}
          onChange={(e) => setTwilio({ ...twilio, authToken: e.target.value })} />
        <Input placeholder="Your authorised phone number" value={twilio.authorisedNumber}
          onChange={(e) => setTwilio({ ...twilio, authorisedNumber: e.target.value })} />
        <Input placeholder="Public tunnel URL (Cloudflare Tunnel / ngrok)" value={twilio.publicUrl}
          onChange={(e) => setTwilio({ ...twilio, publicUrl: e.target.value })} />
        <Button size="sm" onClick={() => saveChannel("twilio", twilio.enabled, twilio)}>Save Twilio</Button>
        <TwilioWizard />
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm flex-1">WhatsApp</p>
          <input type="checkbox" checked={whatsapp.enabled}
            onChange={(e) => setWhatsapp({ ...whatsapp, enabled: e.target.checked })} />
        </div>
        <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.62)" }}>
          WhatsApp itself doesn&apos;t let third-party apps connect directly — Meta only opens it
          through approved Business Solution Providers. Twilio is one of those providers (Meta-approved),
          so the practical setup is: <b>Twilio handles the actual WhatsApp connection on your behalf</b>.
          Sora sends messages to Twilio over their normal SMS-style API; Twilio relays them onto
          WhatsApp using the number you&apos;ve enabled on the Twilio console. Inbound WhatsApp
          messages arrive back at Sora through the same webhook pipeline as SMS.
        </p>
        <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.55)" }}>
          To set it up: in the Twilio console go to <i>Messaging → Try it out → WhatsApp sandbox</i>
          (free, for testing) or onboard a production WhatsApp sender. Twilio will give you a
          WhatsApp-enabled number — paste it below with the <code>whatsapp:</code> prefix.
        </p>
        <Input
          placeholder="WhatsApp 'from' number (Twilio-side), e.g. whatsapp:+14155238886"
          value={whatsapp.fromNumber}
          onChange={(e) => setWhatsapp({ ...whatsapp, fromNumber: e.target.value })}
        />
        <Input
          placeholder="Your authorised WhatsApp number (your phone, e.g. +1...)"
          value={whatsapp.authorisedNumber}
          onChange={(e) => setWhatsapp({ ...whatsapp, authorisedNumber: e.target.value })}
        />
        <Button size="sm" onClick={() => saveChannel("whatsapp", whatsapp.enabled, whatsapp)}>Save WhatsApp</Button>
        {whatsapp.enabled && twilio.publicUrl && (
          <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.55)" }}>
            Twilio WhatsApp inbound webhook: <code>{twilio.publicUrl}/api/channels/twilio/whatsapp</code>
          </p>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Local API &amp; webhook token</p>
        <p className="text-xs text-muted-foreground">
          Use for the REST API (<code>/api/v1</code>) and inbound webhooks (<code>/api/webhooks/&lt;token&gt;</code>).
        </p>
        <Button size="sm" onClick={genToken}>Generate new token</Button>
        {apiToken && (
          <p className="text-xs break-all bg-muted/40 rounded p-2">
            {apiToken} <span className="text-muted-foreground">— copy now, it won't be shown again.</span>
          </p>
        )}
      </Card>
    </div>
  );
}

function DataSection() {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  async function post(action: string, extra: any = {}) {
    const r = await fetch("/api/data", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, pin, ...extra }),
    });
    const j = await r.json();
    if (j.ok) toast("Done", "success");
    else toast(j.error || "Failed", "error");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Data & Privacy</h1>
      <Card className="p-4 space-y-2 text-sm">
        <p>Everything runs on your Mac. Conversations, settings, the audit log and memory live
          in <code>~/.localmind</code>. Nothing leaves the device unless you connect a cloud
          provider, in which case only your chat messages are sent to that provider.</p>
      </Card>
      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Export all data</p>
        <a href="/api/settings/export"><Button size="sm" variant="outline">Download ZIP archive</Button></a>
        <p className="text-xs text-muted-foreground">
          Conversations, audit log, memory, settings, MCP configs, and notes. Secrets redacted.
        </p>
      </Card>
      <Card className="p-4 space-y-2">
        <Input type="password" placeholder="PIN (if set)" value={pin} onChange={(e) => setPin(e.target.value)} className="w-48" />
        <p className="font-medium text-sm">Delete all conversations</p>
        <Button size="sm" variant="destructive"
          onClick={() => confirm2("Delete all conversations permanently?") && post("delete-conversations")}>
          Delete all conversations
        </Button>
        <p className="font-medium text-sm pt-2">Factory reset</p>
        <Input placeholder="Type RESET to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-48" />
        <Button size="sm" variant="destructive" disabled={confirm !== "RESET"}
          onClick={() => post("factory-reset", { confirm })}>
          Factory reset
        </Button>
      </Card>
    </div>
  );
}

function confirm2(msg: string) {
  return typeof window !== "undefined" && window.confirm(msg);
}

function BackupSection() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [restoring, setRestoring] = useState(false);
  const load = () => fetch("/api/backup").then((r) => r.json()).then((j) => setSnapshots(j.snapshots || []));
  useEffect(() => { load(); }, []);

  async function restore(name: string) {
    if (!confirm(`Restore "${name}"? Current data is snapshotted first, then the app restarts.`)) return;
    setRestoring(true);
    await fetch("/api/backup/restore", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshot: name }),
    }).catch(() => {});
    // Poll health until the app comes back, then reload.
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/health");
        if (r.ok) { clearInterval(poll); setTimeout(() => window.location.reload(), 1000); }
      } catch {}
    }, 2000);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Backup</h1>
      {restoring && (
        <div className="fixed inset-0 z-50 bg-background/95 flex flex-col items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="mt-3 text-sm">Restoring backup — the app is restarting…</p>
        </div>
      )}
      <Card className="p-4 space-y-2">
        <Button size="sm" onClick={async () => {
          const j = await (await fetch("/api/backup", { method: "POST" })).json();
          toast(j.ok ? "Backup created" : j.error, j.ok ? "success" : "error");
          load();
        }}>Backup now</Button>
        <p className="text-xs text-muted-foreground">Snapshots are saved to ~/.localmind/backups.</p>
      </Card>
      <Card className="p-4 space-y-1">
        <p className="font-medium text-sm">Available snapshots</p>
        {snapshots.length === 0 && <p className="text-xs text-muted-foreground">No backups yet.</p>}
        {snapshots.map((s) => (
          <div key={s.name} className="text-sm flex items-center gap-2 border-b py-1 last:border-0">
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-xs text-muted-foreground">{new Date(s.timestamp).toLocaleString()}</span>
            <Button size="sm" variant="outline" onClick={() => restore(s.name)}>Restore</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
