"use client";
/**
 * /ops — the Agent Ops Kanban board (Feature A).
 *
 * A single at-a-glance board of every unit of agent work flowing through lanes,
 * updating live (poll every 1.5s like /orchestration). Complements
 * /orchestration (deep control) and /graphs (DAG view); it does not replace
 * them. Cards are sourced from `agent_processes` (+ folded-in workflow
 * approvals) via GET /api/orchestration/processes?board=1.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { Eye, Pause, Play, X, Check, RefreshCw, X as XIcon } from "lucide-react";
import { pillarMeta, PILLAR_META } from "@/components/ops/pillars";

type Proc = {
  process_id: string;
  process_type: string;
  display_name: string;
  agent_name: string | null;
  persona_id: string | null;
  started_at: number;
  completed_at: number | null;
  status: string;
  current_step: string | null;
  metadata_json: string;
  pillar: string | null;
  parent_process_id: string | null;
  progress: number | null;
};

type TraceEvent = { timestamp: number; event_type: string; content: string; duration_ms?: number };

type Lane = "proposals" | "queued" | "running" | "needs_you" | "done" | "failed";
type Board = { lanes: Record<Lane, Proc[]>; counts: Record<Lane, number> };

const LANES: { key: Lane; label: string }[] = [
  { key: "proposals", label: "Proposals" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "needs_you", label: "Needs you" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

const STATUS_TONE: Record<string, "outline" | "success" | "destructive" | "warning"> = {
  running: "success",
  paused: "warning",
  waiting_confirmation: "warning",
  pending: "outline",
  completed: "outline",
  failed: "destructive",
  cancelled: "destructive",
};

const EMPTY: Board = {
  lanes: { proposals: [], queued: [], running: [], needs_you: [], done: [], failed: [] },
  counts: { proposals: 0, queued: 0, running: 0, needs_you: 0, done: 0, failed: 0 },
};

const FILTER_KEY = "lm-ops-pillar-filter";
const GROUP_KEY = "lm-ops-group";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function metaOf(p: Proc): Record<string, unknown> {
  try { return JSON.parse(p.metadata_json || "{}"); } catch { return {}; }
}

export default function OpsPage() {
  const [board, setBoard] = useState<Board>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pillarFilter, setPillarFilter] = useState<string | null>(null);
  const [groupByPillar, setGroupByPillar] = useState(false);
  const [traceProc, setTraceProc] = useState<Proc | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await fetch("/api/orchestration/processes?board=1").then((r) => r.json());
      if (b?.lanes) setBoard(b);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setPillarFilter(localStorage.getItem(FILTER_KEY) || null);
    setGroupByPillar(localStorage.getItem(GROUP_KEY) === "pillar");
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 1500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  function setFilter(p: string | null) {
    setPillarFilter(p);
    if (p) localStorage.setItem(FILTER_KEY, p);
    else localStorage.removeItem(FILTER_KEY);
  }
  function setGrouping(byPillar: boolean) {
    setGroupByPillar(byPillar);
    localStorage.setItem(GROUP_KEY, byPillar ? "pillar" : "status");
  }

  const applyFilter = useCallback(
    (list: Proc[]) => (pillarFilter ? list.filter((p) => p.pillar === pillarFilter) : list),
    [pillarFilter]
  );

  async function pauseProc(id: string) { await fetch(`/api/orchestration/processes/${id}/pause`, { method: "POST" }); refresh(); }
  async function resumeProc(id: string) { await fetch(`/api/orchestration/processes/${id}/resume`, { method: "POST" }); refresh(); }
  async function cancelProc(id: string) {
    if (!confirm("Cancel this process? Any in-flight tool call will be aborted.")) return;
    const r = await fetch(`/api/orchestration/processes/${id}`, { method: "DELETE" });
    if (!r.ok) toast("Could not cancel", "error");
    refresh();
  }

  async function resolveApproval(p: Proc, approved: boolean) {
    const meta = metaOf(p);
    if (meta.kind === "workflow_approval" && meta.run_id) {
      const path = approved ? "approve" : "reject";
      const r = await fetch(`/api/workflows/runs/${meta.run_id}/${path}`, { method: "POST" });
      if (!r.ok) toast("Could not update approval", "error");
      refresh();
      return;
    }
    if (meta.kind === "proposal" && meta.proposal_id) {
      // ready_for_review → merge; proposed → approve. Reject works from either.
      const path = !approved
        ? "reject"
        : meta.proposal_status === "ready_for_review"
          ? "merge"
          : "approve";
      const r = await fetch(`/api/ops/proposals/${meta.proposal_id}/${path}`, { method: "POST" });
      if (!r.ok) toast("Could not update proposal", "error");
      else if (!approved) toast("Proposal rejected.", "success");
      else if (path === "merge") toast("Marked as merged.", "success");
      else toast("Approved — Sora may now build a branch/PR for review.", "success");
      refresh();
      return;
    }
    toast("This item is approved from its own view.", "info");
  }

  function openTrace(p: Proc) {
    esRef.current?.close();
    setTraceProc(p);
    setTraceEvents([]);
    fetch(`/api/orchestration/processes/${p.process_id}/trace`)
      .then((r) => r.json())
      .then((j) => setTraceEvents(j.events || []))
      .catch(() => {});
    if (!p.completed_at && !p.process_id.startsWith("wf-approval-")) {
      try {
        const es = new EventSource(`/api/orchestration/processes/${p.process_id}/trace/stream`);
        esRef.current = es;
        es.addEventListener("trace", (e) => {
          const ev = JSON.parse((e as MessageEvent).data) as TraceEvent;
          setTraceEvents((cur) => {
            const key = `${ev.timestamp}|${ev.event_type}|${ev.content}`;
            if (cur.some((c) => `${c.timestamp}|${c.event_type}|${c.content}` === key)) return cur;
            return [...cur, ev].sort((a, b) => a.timestamp - b.timestamp);
          });
        });
        es.addEventListener("done", () => { es.close(); esRef.current = null; });
        es.onerror = () => { es.close(); esRef.current = null; };
      } catch { /* ignore */ }
    }
  }
  function closeTrace() { esRef.current?.close(); esRef.current = null; setTraceProc(null); setTraceEvents([]); }

  function renderCard(p: Proc) {
    const meta = pillarMeta(p.pillar);
    const Icon = meta.icon;
    const model = metaOf(p).model as string | undefined;
    const active = !p.completed_at;
    const kind = metaOf(p).kind;
    const isApproval = kind === "workflow_approval" || kind === "proposal";
    return (
      <Card key={p.process_id} className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: meta.color }} aria-label={meta.label} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{p.display_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {p.agent_name || p.persona_id || "Sora"}{p.current_step ? ` · ${p.current_step}` : ""}
            </p>
          </div>
          <Badge variant={STATUS_TONE[p.status] || "outline"}>{p.status.replace(/_/g, " ")}</Badge>
        </div>
        {typeof p.progress === "number" && (
          <div className="h-1 rounded bg-muted overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round(Math.max(0, Math.min(1, p.progress)) * 100)}%` }} />
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatDuration((p.completed_at || now) - p.started_at)}</span>
          {model && <Badge variant="outline">{model}</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {!isApproval && (
            <Button size="sm" variant="outline" onClick={() => openTrace(p)}>
              <Eye className="h-3 w-3" /> View
            </Button>
          )}
          {isApproval ? (
            <>
              <Button size="sm" onClick={() => resolveApproval(p, true)}>
                <Check className="h-3 w-3" />{" "}
                {metaOf(p).proposal_status === "ready_for_review" ? "Merge" : "Approve"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolveApproval(p, false)}>
                <X className="h-3 w-3" /> Deny
              </Button>
            </>
          ) : active ? (
            <>
              {p.status !== "paused" ? (
                <Button size="sm" variant="outline" onClick={() => pauseProc(p.process_id)}>
                  <Pause className="h-3 w-3" /> Pause
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => resumeProc(p.process_id)}>
                  <Play className="h-3 w-3" /> Resume
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => cancelProc(p.process_id)}>
                <X className="h-3 w-3" /> Cancel
              </Button>
            </>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="relative flex h-full">
      <div className="flex-1 overflow-hidden flex flex-col px-4 sm:px-8 py-6 sm:py-10 min-w-0">
        <div className="flex items-end justify-between gap-6 mb-4 shrink-0">
          <div>
            <p className="lm-micro mb-2">Ops</p>
            <h1 className="lm-display">Agent Ops board</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Tasks running outside the chat window — jobs, schedules, monitors, subagents, and proposals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={groupByPillar ? "outline" : "default"} onClick={() => setGrouping(false)}>Kanban</Button>
            <Button size="sm" variant={groupByPillar ? "default" : "outline"} onClick={() => setGrouping(true)}>By pillar</Button>
            <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

        {/* Pillar filter */}
        <div className="flex items-center gap-1.5 mb-4 shrink-0 flex-wrap">
          <button
            onClick={() => setFilter(null)}
            className={`text-xs px-2 py-1 rounded-full border ${!pillarFilter ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:bg-muted/50"}`}
          >All</button>
          {Object.entries(PILLAR_META).map(([key, m]) => {
            const Icon = m.icon;
            return (
              <button
                key={key}
                onClick={() => setFilter(pillarFilter === key ? null : key)}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${pillarFilter === key ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:bg-muted/50"}`}
              >
                <Icon className="h-3 w-3" style={{ color: m.color }} /> {m.label}
              </button>
            );
          })}
        </div>

        {!loaded ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : groupByPillar ? (
          <PillarView board={board} applyFilter={applyFilter} renderCard={renderCard} />
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 overflow-x-auto">
            {LANES.map(({ key, label }) => {
              const items = applyFilter(board.lanes[key] || []);
              return (
                <div key={key} className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2 px-1 shrink-0">
                    <h2 className="text-sm font-medium">{label}</h2>
                    <Badge variant="outline">{items.length}</Badge>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-4">Nothing here.</p>
                    ) : (
                      items.map(renderCard)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {traceProc && (
        <aside className="absolute inset-0 z-20 flex flex-col border-l bg-background sm:static sm:z-auto sm:w-[420px] sm:bg-muted/10">
          <div className="border-b px-4 py-2 flex items-center gap-2">
            <p className="text-sm font-medium flex-1 truncate">{traceProc.display_name}</p>
            <Badge variant={STATUS_TONE[traceProc.status] || "outline"}>{traceProc.status}</Badge>
            <button onClick={closeTrace} aria-label="Close trace"><XIcon className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1.5">
            {traceEvents.length === 0 ? (
              <p className="text-muted-foreground">Waiting for events…</p>
            ) : (
              traceEvents.map((e, i) => (
                <div key={i} className="border-l-2 border-muted-foreground/20 pl-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
                    <Badge variant="outline">{e.event_type}</Badge>
                    {e.duration_ms !== undefined && <span className="text-muted-foreground">{e.duration_ms}ms</span>}
                  </div>
                  <pre className="whitespace-pre-wrap break-words mt-0.5">{e.content}</pre>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

// "Group by pillar" view: every non-completed card grouped under its pillar.
function PillarView({
  board,
  applyFilter,
  renderCard,
}: {
  board: Board;
  applyFilter: (l: Proc[]) => Proc[];
  renderCard: (p: Proc) => React.ReactNode;
}) {
  const all = applyFilter([...board.lanes.queued, ...board.lanes.running, ...board.lanes.needs_you]);
  const groups = new Map<string, Proc[]>();
  for (const p of all) {
    const key = p.pillar || "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  if (groups.size === 0) return <p className="text-xs text-muted-foreground">No active work.</p>;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
      {[...groups.entries()].map(([pillar, items]) => {
        const m = pillarMeta(pillar === "unclassified" ? null : pillar);
        const Icon = m.icon;
        return (
          <section key={pillar}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-4 w-4" style={{ color: m.color }} />
              <h2 className="text-sm font-medium">{m.label}</h2>
              <Badge variant="outline">{items.length}</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {items.map(renderCard)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
