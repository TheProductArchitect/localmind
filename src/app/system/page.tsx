"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Badge } from "@/components/ui";
import { toast } from "@/components/toast";

type Health = {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  ollama: string;
  app: string;
};

function gb(n: number) { return (n / 1e9).toFixed(1) + " GB"; }

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function SystemPage() {
  const [h, setH] = useState<Health | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [update, setUpdate] = useState<any>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const tick = async () => {
      try { setH(await (await fetch("/api/system/health")).json()); } catch {}
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const tick = async () => {
      if (pausedRef.current) return;
      try {
        const j = await (await fetch("/api/system/logs")).json();
        setLogs(j.lines || []);
      } catch {}
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/updates/check").then((r) => r.json()).then(setUpdate);
  }, []);

  async function service(name: string, action: string) {
    const r = await fetch(`/api/system/services/${name}/${action}`, { method: "POST" });
    const j = await r.json();
    toast(j.ok ? `${name} ${action} ok` : j.error || "Failed", j.ok ? "success" : "error");
  }

  const visibleLogs = logs.filter((l) => !logFilter || l.toLowerCase().includes(logFilter.toLowerCase()));
  const [tab, setTab] = useState("Health");

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">System Dashboard</h1>
        <div className="flex gap-2">
          {["Health", "Performance"].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-sm border ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "Performance" && <PerformancePanel />}

      {tab === "Health" && h && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">CPU</p>
            <Bar pct={h.cpu} /><p className="text-xs text-muted-foreground mt-1">{h.cpu}%</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Memory</p>
            <Bar pct={(h.ram.used / h.ram.total) * 100} />
            <p className="text-xs text-muted-foreground mt-1">{gb(h.ram.used)} / {gb(h.ram.total)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Disk</p>
            <Bar pct={(h.disk.used / h.disk.total) * 100} />
            <p className="text-xs text-muted-foreground mt-1">{gb(h.disk.used)} / {gb(h.disk.total)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Status</p>
            <div className="flex items-center gap-2 text-sm">
              Ollama <Badge variant={h.ollama === "running" ? "success" : "destructive"}>{h.ollama}</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1">
              LocalMind <Badge variant="success">{h.app}</Badge>
            </div>
          </Card>
        </div>
      )}

      {tab === "Health" && (
      <>
      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Service controls</p>
        <div className="flex flex-wrap gap-2">
          {["ollama", "localmind"].map((svc) => (
            <div key={svc} className="flex items-center gap-1">
              <span className="text-sm capitalize mr-1">{svc}</span>
              {["start", "stop", "restart"].map((a) => (
                <Button key={a} size="sm" variant="outline" onClick={() => service(svc, a)}>
                  {a}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-medium">Live application log</p>
          <input
            placeholder="Filter…"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            className="ml-auto h-7 rounded border px-2 text-xs bg-background"
          />
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <a href="/api/system/logs?download=1"><Button size="sm" variant="outline">Download</Button></a>
        </div>
        <pre className="text-xs bg-muted/40 rounded p-2 h-56 overflow-y-auto">
          {visibleLogs.join("\n") || "(no log lines yet)"}
        </pre>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Updates</p>
        {!update ? (
          <p className="text-xs text-muted-foreground">Checking…</p>
        ) : (
          <div className="text-sm space-y-1">
            <p>Current version: <b>{update.current}</b></p>
            {update.updateAvailable ? (
              <>
                <p>New version available: <b>{update.latest}</b></p>
                <Button size="sm" onClick={async () => {
                  const j = await (await fetch("/api/updates/apply", { method: "POST" })).json();
                  toast(j.message || "Update queued", "success");
                }}>Update now</Button>
              </>
            ) : (
              <p className="text-muted-foreground">{update.error || "You're on the latest version."}</p>
            )}
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  );
}

function PerformancePanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/system/performance").then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Loading performance data…</p>;
  if (data.error) return <p className="text-sm text-muted-foreground">{data.message || data.error}</p>;

  const maxVol = Math.max(1, ...data.dailyVolume.map((d: any) => d.n));
  const assistantMsg = data.models.messages.find((m: any) => m.role === "assistant");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Daily action volume (last {data.days} days)</p>
        {data.dailyVolume.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
        {data.dailyVolume.map((d: any) => (
          <div key={d.day} className="flex items-center gap-2 text-xs my-1">
            <span className="w-24 text-muted-foreground">{d.day}</span>
            <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(d.n / maxVol) * 100}%` }} />
            </div>
            <span className="w-10 text-right">{d.n}</span>
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Tool performance</p>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground text-left">
            <th className="py-1">Tool</th><th>Calls</th><th>Error rate</th>
          </tr></thead>
          <tbody>
            {data.tools.map((t: any) => (
              <tr key={t.tool} className="border-t">
                <td className="py-1">{t.tool}</td>
                <td>{t.calls}</td>
                <td className={t.errorRate > 5 ? "text-destructive" : ""}>{t.errorRate}%</td>
              </tr>
            ))}
            {data.tools.length === 0 && <tr><td colSpan={3} className="py-2 text-muted-foreground">No tool calls yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm font-medium mb-2">Model usage</p>
          <p className="text-xs text-muted-foreground">Conversations: {data.models.conversations}</p>
          <p className="text-xs text-muted-foreground">
            Avg assistant tokens/response: {assistantMsg ? Math.round(assistantMsg.avg_tok || 0) : 0}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium mb-2">Knowledge base</p>
          <p className="text-xs text-muted-foreground">{data.knowledge.documents} documents · {data.knowledge.chunks} chunks</p>
          <ul className="text-xs text-muted-foreground mt-1">
            {data.knowledge.recent.map((d: any, i: number) => (
              <li key={i}>{d.file_name} — {d.status}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Worker health (last 10 jobs)</p>
        {data.workerHealth.length === 0 && <p className="text-xs text-muted-foreground">No completed jobs yet.</p>}
        {data.workerHealth.map((j: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs my-0.5">
            <span className={`h-2 w-2 rounded-full ${j.status === "done" ? "bg-green-500" : "bg-destructive"}`} />
            <span className="flex-1">{j.type}</span>
            <span className="text-muted-foreground">{j.durationMs}ms</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
