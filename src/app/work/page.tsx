"use client";

/**
 * /work — unified timeline of everything Sora is doing or has done.
 *
 * Merges what used to live at /graphs, /orchestration, /automations, and
 * /jobs into a single chronological feed. Each row is a v2 "card row" —
 * a hairline-separated band, no boxed card chrome — so the whole page
 * reads as one continuous timeline.
 *
 * Deep work still happens on the underlying detail pages; this surface is
 * the entry point.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Workflow, Network, Calendar, Briefcase, ChevronRight, RefreshCw, Users } from "lucide-react";

type Kind = "graph" | "process" | "job" | "automation";
type Row = {
  id: string;
  kind: Kind;
  title: string;
  status: string;
  at: number;            // sort key
  detail: string;
  href: string;
};

const FILTERS: { id: Kind | "all"; label: string }[] = [
  { id: "all",        label: "All" },
  { id: "graph",      label: "Graphs" },
  { id: "process",    label: "Processes" },
  { id: "job",        label: "Jobs" },
  { id: "automation", label: "Automations" },
];

const ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  graph: Workflow,
  process: Network,
  job: Briefcase,
  automation: Calendar,
};

function relTime(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000)     return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export default function WorkPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const out: Row[] = [];

    // Graphs
    try {
      const r = await fetch("/api/graphs").then((r) => r.json()).catch(() => null);
      const list = Array.isArray(r?.graphs) ? r.graphs : Array.isArray(r) ? r : [];
      for (const g of list) {
        out.push({
          id: `g-${g.graph_id ?? g.id}`,
          kind: "graph",
          title: g.root_goal ?? g.title ?? "Untitled graph",
          status: g.status ?? "unknown",
          at: g.completed_at ?? g.created_at ?? Date.now(),
          detail: `${g.node_counts?.done ?? 0}/${g.node_counts?.total ?? 0} nodes`,
          href: `/graphs/${g.graph_id ?? g.id}`,
        });
      }
    } catch { /* ignore */ }

    // Processes (orchestration)
    try {
      const r = await fetch("/api/orchestration/processes").then((r) => r.json()).catch(() => null);
      const list = Array.isArray(r?.processes) ? r.processes : Array.isArray(r) ? r : [];
      for (const p of list) {
        out.push({
          id: `p-${p.process_id}`,
          kind: "process",
          title: p.display_name || p.process_type || "Process",
          status: p.status || "unknown",
          at: p.completed_at ?? p.started_at ?? Date.now(),
          detail: p.current_step || p.process_type || "",
          href: `/orchestration?process=${p.process_id}`,
        });
      }
    } catch { /* ignore */ }

    // Jobs
    try {
      const r = await fetch("/api/jobs").then((r) => r.json()).catch(() => null);
      const list = Array.isArray(r?.jobs) ? r.jobs : Array.isArray(r) ? r : [];
      for (const j of list) {
        out.push({
          id: `j-${j.id}`,
          kind: "job",
          title: j.name || j.kind || "Job",
          status: j.status || "unknown",
          at: j.updated_at ?? j.created_at ?? Date.now(),
          detail: j.summary || j.kind || "",
          href: `/work?tab=jobs&id=${j.id}`,
        });
      }
    } catch { /* ignore */ }

    // Automations
    try {
      const r = await fetch("/api/automations/tasks").then((r) => r.json()).catch(() => null);
      const list = Array.isArray(r?.tasks) ? r.tasks : Array.isArray(r) ? r : [];
      for (const a of list) {
        out.push({
          id: `a-${a.id}`,
          kind: "automation",
          title: a.name || "Automation",
          status: a.last_status || a.status || "scheduled",
          at: a.last_run_at ?? a.next_run_at ?? a.created_at ?? Date.now(),
          detail: a.schedule || "",
          href: "/automations",
        });
      }
    } catch { /* ignore */ }

    out.sort((a, b) => b.at - a.at);
    setRows(out);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  return (
    <div className="mx-auto max-w-4xl px-10 py-16">
      <header className="mb-12 flex items-end justify-between">
        <div>
          <p className="lm-micro mb-2">Work</p>
          <h1 className="lm-display">Everything in motion</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agents" className="lm-action lm-action--ghost" data-pulse="true">
            <Users className="h-3.5 w-3.5" /> Agents
          </Link>
          <button
            onClick={load}
            aria-label="Refresh"
            className="lm-icon-btn"
            data-pulse="true"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="mb-8 flex gap-2 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 text-[12px] transition-colors"
              style={{
                border: "1px solid hsl(0 0% 100% / 0.10)",
                borderRadius: "var(--lm-radius-pill)",
                background: active ? "hsl(0 0% 100% / 0.10)" : "transparent",
                color: active ? "hsl(0 0% 100%)" : "hsl(0 0% 100% / 0.55)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div>
        {visible.length === 0 && !loading && (
          <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
            Nothing here yet. Start a conversation, schedule an automation, or kick off a task graph.
          </p>
        )}
        {visible.map((r) => {
          const I = ICON[r.kind];
          return (
            <Link
              key={r.id}
              href={r.href}
              className="lm-work-row group"
              data-pulse="true"
            >
              <span className="lm-work-row__icon"><I className="h-4 w-4" /></span>
              <span className="lm-work-row__title">{r.title}</span>
              <span className="lm-work-row__detail">{r.detail}</span>
              <span className="lm-work-row__status" data-status={r.status}>{r.status}</span>
              <span className="lm-work-row__time">{relTime(r.at)}</span>
              <ChevronRight className="lm-work-row__chev h-4 w-4" />
            </Link>
          );
        })}
      </div>

      <style jsx>{`
        .lm-work-row {
          display: grid;
          grid-template-columns: 28px 1fr auto auto auto 16px;
          align-items: center;
          gap: 16px;
          padding: 18px 4px;
          border-bottom: 1px solid hsl(0 0% 100% / 0.06);
          color: hsl(0 0% 100% / 0.92);
          transition: background var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-work-row:hover { background: hsl(0 0% 100% / 0.025); }
        .lm-work-row__icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px;
          border-radius: 8px;
          background: hsl(0 0% 100% / 0.04);
          color: hsl(0 0% 100% / 0.72);
        }
        .lm-work-row__title { font-size: 14px; letter-spacing: -0.005em; }
        .lm-work-row__detail {
          font-size: 12px; color: hsl(0 0% 100% / 0.4);
          max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lm-work-row__status {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 9999px;
          color: hsl(0 0% 100% / 0.6);
          border: 1px solid hsl(0 0% 100% / 0.10);
        }
        .lm-work-row__status[data-status="running"],
        .lm-work-row__status[data-status="active"] {
          color: hsl(0 0% 100%);
          border-color: hsl(0 0% 100% / 0.4);
          box-shadow: 0 0 12px hsl(0 0% 100% / 0.3);
        }
        .lm-work-row__status[data-status="failed"],
        .lm-work-row__status[data-status="error"],
        .lm-work-row__status[data-status="cancelled"] {
          color: hsl(0 100% 78%);
          border-color: hsl(0 90% 64% / 0.4);
        }
        .lm-work-row__time { font-size: 12px; color: hsl(0 0% 100% / 0.4); }
        .lm-work-row__chev { color: hsl(0 0% 100% / 0.2); }
      `}</style>
    </div>
  );
}
