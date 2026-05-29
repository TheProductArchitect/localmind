"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Badge } from "@/components/ui";
import { toast } from "@/components/toast";

const SECTIONS = ["General", "Tools", "Network", "Providers", "Communications", "Data & Privacy", "Backup"];

export default function SettingsPage() {
  const [section, setSection] = useState("General");
  return (
    <div className="flex h-full">
      <div className="w-44 shrink-0 border-r p-2">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`block w-full text-left rounded-md px-3 py-1.5 text-sm ${
              section === s ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {section === "General" && <GeneralSection />}
        {section === "Tools" && <ToolsSection />}
        {section === "Network" && <NetworkSection />}
        {section === "Providers" && <ProvidersSection />}
        {section === "Communications" && <CommsSection />}
        {section === "Data & Privacy" && <DataSection />}
        {section === "Backup" && <BackupSection />}
      </div>
    </div>
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
      <h1 className="text-xl font-semibold">General</h1>
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
    </div>
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

function ToolsSection() {
  const MAC_TOOLS = [
    { id: "calendar", label: "Calendar", desc: "Read and create macOS Calendar events." },
    { id: "email", label: "Mail", desc: "Read and send mail via macOS Mail." },
    { id: "mac_automation", label: "Mac automation", desc: "Open apps, URLs, and post notifications." },
  ];
  const [status, setStatus] = useState<Record<string, any>>({});

  async function verify(tool: string) {
    alert("macOS will ask for permission. If no dialog appears, grant access in System Settings → Privacy & Security.");
    setStatus((s) => ({ ...s, [tool]: { checking: true } }));
    const j = await (await fetch("/api/tools/verify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool }),
    })).json();
    setStatus((s) => ({ ...s, [tool]: j }));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tools</h1>
      <p className="text-xs text-muted-foreground">
        macOS tools need a one-time permission grant. Click Verify to trigger the system dialog
        and confirm access.
      </p>
      {MAC_TOOLS.map((t) => {
        const st = status[t.id];
        return (
          <Card key={t.id} className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm flex-1">{t.label}</p>
              {st?.verified && <Badge variant="success">Verified</Badge>}
              {st && st.verified === false && <Badge variant="warning">Permission denied</Badge>}
              <Button size="sm" variant="outline" onClick={() => verify(t.id)}>
                {st?.checking ? "Checking…" : "Verify access"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t.desc}</p>
            {st && st.verified === false && (
              <a href={st.settingsPane} className="text-xs underline text-amber-600">
                Open System Settings to grant access
              </a>
            )}
          </Card>
        );
      })}
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
  const [apiToken, setApiToken] = useState("");

  useEffect(() => {
    fetch("/api/channels?type=telegram").then((r) => r.json()).then((j) =>
      setTelegram({ enabled: j.enabled, botToken: j.config?.botToken || "", defaultChatId: j.config?.defaultChatId || "" }));
    fetch("/api/channels?type=twilio").then((r) => r.json()).then((j) =>
      setTwilio({ enabled: j.enabled, accountSid: j.config?.accountSid || "", authToken: j.config?.authToken || "",
        authorisedNumber: j.config?.authorisedNumber || "", publicUrl: j.config?.publicUrl || "" }));
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
