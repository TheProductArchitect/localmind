"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Badge, Button } from "@/components/ui";
import { BarChart3, RefreshCw, Activity, Wrench, Workflow, AlertTriangle, Zap } from "lucide-react";

type Analytics = {
  window: string;
  window_ms: number;
  since: number;
  tool_usage: Array<{
    name: string;
    calls: number;
    allowed: number;
    denied: number;
    failed: number;
    other: number;
    success_rate: number;
  }>;
  process_breakdown: Record<string, { running: number; completed: number; failed: number; cancelled: number; total: number }>;
  subagent_performance: {
    window_minutes: number;
    total_runs: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    success_rate: number;
    median_duration_ms: number | null;
    p95_duration_ms: number | null;
    by_batch_size: Array<{
      batch_size: number;
      runs: number;
      success_rate: number;
      median_duration_ms: number | null;
    }>;
    summary: string;
  };
  task_graphs: {
    counts_by_status: Record<string, number>;
    total_tokens: number;
    total_wall_seconds: number;
  };
  tool_call_cache: { rows: number; total_hits: number };
  recent_failures: Array<{
    id: number;
    timestamp: number;
    action_type: string;
    tool_name: string;
    output_summary: string;
    conversation_id: string | null;
  }>;
  activity_buckets: Array<{ start: number; count: number; label: string }>;
};

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function secs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [window, setWindow] = useState("24h");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (w: string) => {
    setLoaded(false);
    try {
      const r = await fetch(`/api/analytics?window=${w}`);
      const j = await r.json();
      setData(j);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(window); }, [window, load]);

  const peakActivity = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.activity_buckets.map((b) => b.count));
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-10 py-14 space-y-6">
      <div className="flex items-end justify-between gap-6 mb-2">
        <div>
          <p className="lm-micro mb-2">Analytics</p>
          <h1 className="lm-display">What Sora&apos;s been up to</h1>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={`rounded-md px-2 py-1 text-xs border ${window === w.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => load(window)}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        What Sora's been up to. All data sourced from your local audit log, agent processes, task graphs,
        and tool-call cache — nothing leaves the box.
      </p>

      {!loaded ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
      ) : !data ? (
        <Card className="p-4 text-sm text-destructive">No data returned.</Card>
      ) : (
        <>
          {/* Top metrics cards */}
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Activity className="h-4 w-4" />}
              label="Tool calls"
              value={data.tool_usage.reduce((s, t) => s + t.calls, 0).toString()}
              hint={`${data.tool_usage.length} distinct tools`}
            />
            <MetricCard
              icon={<Wrench className="h-4 w-4" />}
              label="Subagent runs"
              value={data.subagent_performance.total_runs.toString()}
              hint={data.subagent_performance.total_runs > 0
                ? `${pct(data.subagent_performance.success_rate)} success · median ${secs(data.subagent_performance.median_duration_ms)}`
                : "no subagent activity"}
            />
            <MetricCard
              icon={<Workflow className="h-4 w-4" />}
              label="Task graphs"
              value={Object.values(data.task_graphs.counts_by_status).reduce((a, b) => a + b, 0).toString()}
              hint={`${data.task_graphs.total_tokens.toLocaleString()} tokens · ${secs(data.task_graphs.total_wall_seconds * 1000)} wall`}
            />
            <MetricCard
              icon={<Zap className="h-4 w-4" />}
              label="Tool-cache hits"
              value={data.tool_call_cache.total_hits.toLocaleString()}
              hint={`${data.tool_call_cache.rows} cached entries`}
            />
          </div>

          {/* Activity sparkline */}
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Activity ({data.window})</p>
            {data.activity_buckets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity in this window.</p>
            ) : (
              <div className="flex items-end gap-px h-24">
                {data.activity_buckets.map((b) => {
                  const h = Math.max(2, Math.round((b.count / peakActivity) * 100));
                  return (
                    <div
                      key={b.start}
                      className="flex-1 bg-primary/70 hover:bg-primary"
                      style={{ height: `${h}%` }}
                      title={`${b.label} — ${b.count} actions`}
                    />
                  );
                })}
              </div>
            )}
            {data.activity_buckets.length > 0 && (
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>{data.activity_buckets[0].label}</span>
                <span>{data.activity_buckets[data.activity_buckets.length - 1].label}</span>
              </div>
            )}
          </Card>

          {/* Tool usage table */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-2 border-b">
              <p className="text-sm font-medium">Tool usage</p>
            </div>
            {data.tool_usage.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No tool calls in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs border-b">
                    <th className="px-4 py-2">Tool</th>
                    <th>Calls</th>
                    <th>Success</th>
                    <th>Denied</th>
                    <th>Failed</th>
                    <th className="w-40">Success rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tool_usage.map((t) => (
                    <tr key={t.name} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{t.name}</td>
                      <td>{t.calls}</td>
                      <td className="text-green-600">{t.allowed}</td>
                      <td className="text-amber-600">{t.denied || "—"}</td>
                      <td className="text-destructive">{t.failed || "—"}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden max-w-32">
                            <div className={`h-full ${t.success_rate > 0.9 ? "bg-green-500" : t.success_rate > 0.7 ? "bg-amber-500" : "bg-destructive"}`} style={{ width: `${t.success_rate * 100}%` }} />
                          </div>
                          <span className="text-xs">{pct(t.success_rate)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Subagent performance */}
          <Card className="p-4">
            <p className="text-sm font-medium mb-1">Subagent performance</p>
            <p className="text-xs text-muted-foreground mb-3">{data.subagent_performance.summary}</p>
            {data.subagent_performance.total_runs > 0 && data.subagent_performance.by_batch_size.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">By batch size</p>
                <table className="text-xs w-full max-w-2xl">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="py-1">Batch size</th>
                      <th>Runs</th>
                      <th>Success rate</th>
                      <th>Median duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subagent_performance.by_batch_size.map((g) => (
                      <tr key={g.batch_size} className="border-t">
                        <td className="py-1">{g.batch_size}</td>
                        <td>{g.runs}</td>
                        <td>
                          <Badge variant={g.success_rate >= 0.8 ? "success" : g.success_rate >= 0.5 ? "warning" : "destructive"}>
                            {pct(g.success_rate)}
                          </Badge>
                        </td>
                        <td>{secs(g.median_duration_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Process breakdown */}
          {Object.keys(data.process_breakdown).length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-medium mb-2">Process breakdown</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(data.process_breakdown).map(([type, counts]) => (
                  <div key={type} className="rounded-md border bg-card p-3">
                    <p className="text-xs font-medium capitalize">{type.replace(/_/g, " ")} ({counts.total})</p>
                    <div className="flex gap-3 text-xs mt-1">
                      {counts.running > 0 && <span className="text-green-600">{counts.running} running</span>}
                      <span className="text-muted-foreground">{counts.completed} completed</span>
                      {counts.failed > 0 && <span className="text-destructive">{counts.failed} failed</span>}
                      {counts.cancelled > 0 && <span className="text-amber-600">{counts.cancelled} cancelled</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent failures */}
          {data.recent_failures.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm font-medium">Recent failures</p>
              </div>
              <div className="space-y-1.5">
                {data.recent_failures.map((f) => (
                  <Link key={f.id} href={`/audit?id=${f.id}`} className="block text-xs hover:bg-accent/40 rounded px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono">#{f.id}</span>
                      <Badge variant="outline">{f.tool_name || f.action_type}</Badge>
                      <span className="text-muted-foreground">{new Date(f.timestamp).toLocaleString()}</span>
                    </div>
                    {f.output_summary && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 pl-2">{f.output_summary}</p>
                    )}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </Card>
  );
}
