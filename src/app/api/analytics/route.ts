/**
 * GET /api/analytics?window=24h
 *
 * Rolled-up view of what Sora has been doing. Aggregates from:
 *   - audit_log               → tool usage breakdown, action statuses
 *   - agent_processes         → process counts, durations, subagent runs
 *   - tool_call_cache         → cache hit rates
 *   - task_graphs / task_nodes → graph counts + cost rollups
 *
 * window query param: 1h | 6h | 24h | 7d | 30d (default 24h)
 *
 * Designed for the /analytics dashboard but also usable directly by Sora as
 * a "self-reflection" surface (she can call check_resources for live state +
 * this endpoint for historical patterns).
 */

import { NextRequest, NextResponse } from "next/server";
import { getConfigDb } from "@/lib/db";
import { recentSubagentPerformance } from "@/lib/agent/resource-governor";

export const runtime = "nodejs";

function windowMs(w: string): number {
  switch (w) {
    case "1h": return 60 * 60_000;
    case "6h": return 6 * 60 * 60_000;
    case "7d": return 7 * 24 * 60 * 60_000;
    case "30d": return 30 * 24 * 60 * 60_000;
    case "24h":
    default: return 24 * 60 * 60_000;
  }
}

export async function GET(req: NextRequest) {
  const w = req.nextUrl.searchParams.get("window") || "24h";
  const sinceMs = Date.now() - windowMs(w);
  const db = getConfigDb();

  // ── Tool usage ───────────────────────────────────────────────────────────
  const toolRows = db
    .prepare(
      `SELECT tool_name, status, COUNT(*) as count, AVG(timestamp) as avg_ts
       FROM audit_log
       WHERE timestamp >= ? AND tool_name != ''
       GROUP BY tool_name, status
       ORDER BY count DESC`
    )
    .all(sinceMs) as Array<{ tool_name: string; status: string; count: number }>;

  // Aggregate by tool (collapse statuses)
  const toolMap = new Map<string, { calls: number; allowed: number; denied: number; failed: number; other: number }>();
  for (const r of toolRows) {
    const cur = toolMap.get(r.tool_name) ?? { calls: 0, allowed: 0, denied: 0, failed: 0, other: 0 };
    cur.calls += r.count;
    if (r.status === "allowed") cur.allowed += r.count;
    else if (r.status === "denied") cur.denied += r.count;
    else if (r.status === "failed") cur.failed += r.count;
    else cur.other += r.count;
    toolMap.set(r.tool_name, cur);
  }
  const toolUsage = [...toolMap.entries()]
    .map(([name, v]) => ({ name, ...v, success_rate: v.calls > 0 ? v.allowed / v.calls : 0 }))
    .sort((a, b) => b.calls - a.calls);

  // ── Process counts by type ──────────────────────────────────────────────
  const processRows = db
    .prepare(
      `SELECT process_type, status, COUNT(*) as count
       FROM agent_processes
       WHERE started_at >= ?
       GROUP BY process_type, status`
    )
    .all(sinceMs) as Array<{ process_type: string; status: string; count: number }>;
  const processBreakdown = new Map<string, { running: number; completed: number; failed: number; cancelled: number; total: number }>();
  for (const r of processRows) {
    const cur = processBreakdown.get(r.process_type) ?? { running: 0, completed: 0, failed: 0, cancelled: 0, total: 0 };
    cur.total += r.count;
    if (r.status === "running") cur.running += r.count;
    else if (r.status === "completed") cur.completed += r.count;
    else if (r.status === "failed") cur.failed += r.count;
    else if (r.status === "cancelled") cur.cancelled += r.count;
    processBreakdown.set(r.process_type, cur);
  }

  // ── Subagent perf (uses governor's rollup over the configured window) ──
  const subagentPerf = recentSubagentPerformance(Math.round(windowMs(w) / 60_000));

  // ── Task graph cost rollup ──────────────────────────────────────────────
  const graphRows = db
    .prepare(
      `SELECT status, COUNT(*) AS n, cost_actual_json
       FROM task_graphs
       WHERE created_at >= ?
       GROUP BY status, cost_actual_json`
    )
    .all(sinceMs) as Array<{ status: string; n: number; cost_actual_json: string }>;

  let totalTokens = 0;
  let totalWallSeconds = 0;
  const graphsByStatus: Record<string, number> = {};
  for (const g of graphRows) {
    graphsByStatus[g.status] = (graphsByStatus[g.status] ?? 0) + g.n;
    try {
      const c = JSON.parse(g.cost_actual_json) as { tokens?: number; wall_seconds?: number };
      totalTokens += (c.tokens ?? 0) * g.n;
      totalWallSeconds += (c.wall_seconds ?? 0) * g.n;
    } catch { /* skip */ }
  }

  // ── Tool-call cache hit rate ────────────────────────────────────────────
  const cacheStats = db
    .prepare(`SELECT COUNT(*) AS rows, COALESCE(SUM(hit_count), 0) AS total_hits FROM tool_call_cache`)
    .get() as { rows: number; total_hits: number };

  // ── Recent failures (top 10 failed audit rows) ──────────────────────────
  const recentFailures = db
    .prepare(
      `SELECT id, timestamp, action_type, tool_name, output_summary, conversation_id
       FROM audit_log
       WHERE timestamp >= ? AND status IN ('failed', 'denied')
       ORDER BY timestamp DESC
       LIMIT 10`
    )
    .all(sinceMs) as Array<{
      id: number;
      timestamp: number;
      action_type: string;
      tool_name: string;
      output_summary: string | null;
      conversation_id: string | null;
    }>;

  // ── Daily activity (audit-log events per hour bucket) ──────────────────
  // Cheap binning — for short windows hourly, for long windows daily.
  const bucketMs = windowMs(w) <= 24 * 60 * 60_000 ? 60 * 60_000 : 24 * 60 * 60_000;
  const activityRows = db
    .prepare(
      `SELECT (timestamp / ?) * ? AS bucket_start, COUNT(*) AS count
       FROM audit_log
       WHERE timestamp >= ?
       GROUP BY bucket_start
       ORDER BY bucket_start`
    )
    .all(bucketMs, bucketMs, sinceMs) as Array<{ bucket_start: number; count: number }>;

  return NextResponse.json({
    window: w,
    window_ms: windowMs(w),
    since: sinceMs,
    tool_usage: toolUsage,
    process_breakdown: Object.fromEntries(processBreakdown),
    subagent_performance: subagentPerf,
    task_graphs: {
      counts_by_status: graphsByStatus,
      total_tokens: Math.round(totalTokens),
      total_wall_seconds: Math.round(totalWallSeconds),
    },
    tool_call_cache: {
      rows: cacheStats.rows,
      total_hits: cacheStats.total_hits,
    },
    recent_failures: recentFailures.map((r) => ({
      ...r,
      output_summary: (r.output_summary ?? "").slice(0, 200),
    })),
    activity_buckets: activityRows.map((r) => ({
      start: r.bucket_start,
      count: r.count,
      label: bucketMs < 24 * 60 * 60_000
        ? new Date(r.bucket_start).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })
        : new Date(r.bucket_start).toLocaleDateString(),
    })),
    bucket_size_ms: bucketMs,
  });
}
