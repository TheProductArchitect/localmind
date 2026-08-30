"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Button } from "@/components/ui";
import { Workflow, RefreshCw, ChevronRight } from "lucide-react";

type GraphRow = {
  graph_id: string;
  root_goal: string;
  status: string;
  cost_budget: { tokens?: number; wall_seconds?: number; usd?: number };
  cost_actual: { tokens: number; wall_seconds: number; usd: number };
  created_at: number;
  completed_at: number | null;
  node_counts: { total: number; done: number; running: number; failed: number };
};

const STATUS_TONE: Record<string, "outline" | "success" | "destructive" | "warning"> = {
  pending: "outline",
  running: "success",
  completed: "success",
  failed: "destructive",
  cancelled: "destructive",
  halted_budget: "warning",
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function durationOf(g: GraphRow): string {
  const end = g.completed_at ?? Date.now();
  const ms = end - g.created_at;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function pct(actual: number, budget?: number): string {
  if (!budget || budget === 0) return "—";
  return `${Math.round((actual / budget) * 100)}%`;
}

export default function GraphsPage() {
  const [graphs, setGraphs] = useState<GraphRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/graphs");
      const j = await r.json().catch(() => ({}));
      setGraphs(j.graphs || []);
    } catch {
      /* keep last good list */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const visible = graphs.filter((g) =>
    !filter ||
    g.root_goal.toLowerCase().includes(filter.toLowerCase()) ||
    g.graph_id.toLowerCase().includes(filter.toLowerCase()) ||
    g.status.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-6xl px-10 py-14 space-y-6">
      <div className="flex items-end justify-between gap-6 mb-2">
        <div>
          <p className="lm-micro mb-2">Task graphs</p>
          <h1 className="lm-display">How Sora plans</h1>
        </div>
        <input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm w-56"
        />
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Every V6 agent invocation runs as a task graph. Nodes here are real units of work — each one
        has a content-addressed input hash (so identical work hits the cache), a budget contract,
        and explicit placement (local or peer). Click a row to drill into the DAG and the trace.
      </p>

      {!loaded ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
      ) : visible.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {graphs.length === 0
            ? "No task graphs yet. Graphs are created by the executor when an agent runs. The debug-graph self-test creates a few; you can run it from the system console."
            : `No graphs match "${filter}".`}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b">
                <th className="px-3 py-2">Goal</th>
                <th>Status</th>
                <th>Nodes</th>
                <th>Cost (tokens)</th>
                <th>Cost (s)</th>
                <th>Started</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.graph_id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-3 py-2 max-w-md">
                    <div className="truncate font-medium">{g.root_goal}</div>
                    <div className="text-xs text-muted-foreground">{g.graph_id}</div>
                  </td>
                  <td><Badge variant={STATUS_TONE[g.status] || "outline"}>{g.status}</Badge></td>
                  <td className="text-xs">
                    {g.node_counts.done}/{g.node_counts.total}
                    {g.node_counts.failed > 0 && <span className="text-destructive"> · {g.node_counts.failed} failed</span>}
                    {g.node_counts.running > 0 && <span className="text-green-600"> · {g.node_counts.running} running</span>}
                  </td>
                  <td className="text-xs">
                    {g.cost_actual.tokens.toLocaleString()}{" "}
                    <span className="text-muted-foreground">/ {g.cost_budget.tokens?.toLocaleString() ?? "∞"} ({pct(g.cost_actual.tokens, g.cost_budget.tokens)})</span>
                  </td>
                  <td className="text-xs">
                    {g.cost_actual.wall_seconds.toFixed(1)}s
                  </td>
                  <td className="text-xs text-muted-foreground">{relativeTime(g.created_at)}</td>
                  <td className="text-xs">{durationOf(g)}</td>
                  <td className="text-right pr-3">
                    <Link
                      href={`/graphs/${g.graph_id}`}
                      aria-label={`Open graph ${g.graph_id}`}
                      title="Open graph"
                    >
                      <Button size="sm" variant="ghost" aria-hidden tabIndex={-1}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
