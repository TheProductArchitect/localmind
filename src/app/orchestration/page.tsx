"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Badge, Input, Textarea } from "@/components/ui";
import { toast } from "@/components/toast";
import { Network, Eye, Pause, Play, X, Clock, RefreshCw, Plus, Zap, Send } from "lucide-react";

type Proc = {
  process_id: string;
  process_type: string;
  display_name: string;
  owner_user_id: string | null;
  agent_name: string | null;
  persona_id: string | null;
  started_at: number;
  completed_at: number | null;
  status: string;
  current_step: string | null;
  priority: number;
  metadata_json: string;
};

type TraceEvent = {
  timestamp: number;
  event_type: string;
  content: string;
  duration_ms?: number;
};

const TYPE_LABELS: Record<string, string> = {
  chat: "Chat",
  workflow: "Workflow",
  scheduled_task: "Scheduled",
  monitor_check: "Monitor",
  long_running_job: "Long-running",
};

const STATUS_TONE: Record<string, "outline" | "success" | "destructive" | "warning"> = {
  running: "success",
  paused: "warning",
  waiting_confirmation: "warning",
  pending: "outline",
  completed: "outline",
  failed: "destructive",
  cancelled: "destructive",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

type LongJob = {
  job_id: string;
  job_name: string;
  goal: string;
  status: string;
  created_at: number;
  last_checkpoint_at: number | null;
  current_iteration: number;
  max_iterations: number;
  conversation_id: string | null;
};

export default function OrchestrationPage() {
  const [active, setActive] = useState<Proc[]>([]);
  const [history, setHistory] = useState<Proc[]>([]);
  const [jobs, setJobs] = useState<LongJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [traceProc, setTraceProc] = useState<Proc | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);

  // New-job form
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobName, setJobName] = useState("");
  const [jobGoal, setJobGoal] = useState("");
  const [maxIter, setMaxIter] = useState(50);
  const [maxHours, setMaxHours] = useState(2);
  const [stopCond, setStopCond] = useState("natural");

  // Inject-instruction state per job
  const [injectingJobId, setInjectingJobId] = useState<string | null>(null);
  const [injectMessage, setInjectMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [a, h, j] = await Promise.all([
        fetch("/api/orchestration/processes").then((r) => r.json()),
        fetch("/api/orchestration/processes?history=1").then((r) => r.json()),
        fetch("/api/jobs").then((r) => r.json()).catch(() => ({ jobs: [] })),
      ]);
      setActive(a.processes || []);
      setHistory(h.processes || []);
      setJobs(j.jobs || []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  async function createJob() {
    if (!jobName.trim() || !jobGoal.trim()) return;
    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_name: jobName,
        goal: jobGoal,
        max_iterations: maxIter,
        max_duration_hours: maxHours,
        stopping_condition: stopCond || "natural",
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Could not create job", "error");
      return;
    }
    toast("Job queued — the worker picks it up on the next tick.", "success");
    setShowJobForm(false);
    setJobName(""); setJobGoal(""); setMaxIter(50); setMaxHours(2); setStopCond("natural");
    refresh();
  }

  async function cancelJob(jobId: string) {
    if (!confirm("Cancel this job? Any in-flight iteration will finish, then the job stops.")) return;
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    refresh();
  }

  async function submitInject(jobId: string) {
    if (!injectMessage.trim()) return;
    const r = await fetch(`/api/jobs/${jobId}/inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: injectMessage }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Could not inject", "error");
      return;
    }
    toast("Instruction queued for the next iteration.", "success");
    setInjectingJobId(null);
    setInjectMessage("");
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [refresh]);

  async function pauseProc(id: string) {
    await fetch(`/api/orchestration/processes/${id}/pause`, { method: "POST" });
    refresh();
  }
  async function resumeProc(id: string) {
    await fetch(`/api/orchestration/processes/${id}/resume`, { method: "POST" });
    refresh();
  }
  async function cancelProc(id: string) {
    if (!confirm("Cancel this process? Any in-flight tool call will be aborted.")) return;
    const r = await fetch(`/api/orchestration/processes/${id}`, { method: "DELETE" });
    if (!r.ok) toast("Could not cancel", "error");
    refresh();
  }

  function openTrace(p: Proc) {
    setTraceProc(p);
    setTraceEvents([]);

    // Initial fetch for completed processes + a starting point for live ones.
    fetch(`/api/orchestration/processes/${p.process_id}/trace`)
      .then((r) => r.json())
      .then((j) => setTraceEvents(j.events || []))
      .catch(() => {});

    if (!p.completed_at) {
      // Live SSE stream for in-flight processes.
      try {
        const es = new EventSource(`/api/orchestration/processes/${p.process_id}/trace/stream`);
        eventSourceRef.current = es;
        es.addEventListener("trace", (e) => {
          const ev = JSON.parse((e as MessageEvent).data) as TraceEvent;
          setTraceEvents((cur) => {
            const key = `${ev.timestamp}|${ev.event_type}|${ev.content}`;
            if (cur.some((c) => `${c.timestamp}|${c.event_type}|${c.content}` === key)) return cur;
            return [...cur, ev].sort((a, b) => a.timestamp - b.timestamp);
          });
        });
        es.addEventListener("done", () => { es.close(); eventSourceRef.current = null; refresh(); });
        es.onerror = () => { es.close(); eventSourceRef.current = null; };
      } catch { /* ignore */ }
    }
  }

  function closeTrace() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTraceProc(null);
    setTraceEvents([]);
  }

  // Clean up SSE on unmount.
  useEffect(() => () => { eventSourceRef.current?.close(); }, []);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-5xl">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          <h1 className="text-xl font-semibold flex-1">Orchestration</h1>
          <Button size="sm" onClick={() => setShowJobForm((s) => !s)}>
            <Plus className="h-3.5 w-3.5" /> New job
          </Button>
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* New-job form */}
        {showJobForm && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              <p className="text-sm font-medium flex-1">Create a long-running job</p>
              <Button size="sm" variant="ghost" onClick={() => setShowJobForm(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <Input
              placeholder="Job name (e.g. Vector DB landscape research)"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
            <Textarea
              rows={4}
              placeholder="Goal in plain English. Be specific — what should be produced, where it should be saved."
              value={jobGoal}
              onChange={(e) => setJobGoal(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-3">
              <label className="text-sm">
                Max iterations
                <Input
                  type="number"
                  value={maxIter}
                  onChange={(e) => setMaxIter(Math.max(1, Math.min(500, Number(e.target.value))))}
                  className="mt-1"
                />
              </label>
              <label className="text-sm">
                Max hours
                <Input
                  type="number"
                  value={maxHours}
                  onChange={(e) => setMaxHours(Math.max(1, Math.min(24, Number(e.target.value))))}
                  className="mt-1"
                />
              </label>
              <label className="text-sm">
                Stopping condition
                <Input
                  value={stopCond}
                  onChange={(e) => setStopCond(e.target.value)}
                  placeholder="natural"
                  className="mt-1"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              "natural" lets the agent decide when it's done (emit [[DONE]]). Any other value is
              treated as a literal substring — when an iteration output contains it, the job stops.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={createJob} disabled={!jobName.trim() || !jobGoal.trim()}>
                Start job
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowJobForm(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        {/* Long-running jobs */}
        <section>
          <h2 className="text-sm font-medium mb-2">Long-running jobs ({jobs.length})</h2>
          {jobs.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              No long-running jobs yet. Click <b>New job</b> above to start one.
            </Card>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => {
                const done = ["completed", "failed", "cancelled"].includes(j.status);
                return (
                  <Card key={j.job_id} className="p-3">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline">Job</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{j.job_name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{j.goal}</p>
                      </div>
                      <Badge variant={STATUS_TONE[j.status] || "outline"}>{j.status}</Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {j.current_iteration} / {j.max_iterations}
                      </span>
                    </div>
                    {!done && (
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" variant="outline" onClick={() => setInjectingJobId(j.job_id === injectingJobId ? null : j.job_id)}>
                          <Send className="h-3 w-3" /> Inject
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => cancelJob(j.job_id)}>
                          <X className="h-3 w-3" /> Cancel
                        </Button>
                      </div>
                    )}
                    {injectingJobId === j.job_id && (
                      <div className="mt-2 space-y-2 border-t pt-2">
                        <Textarea
                          rows={2}
                          placeholder="Instruction to inject before the next iteration…"
                          value={injectMessage}
                          onChange={(e) => setInjectMessage(e.target.value)}
                        />
                        <Button size="sm" onClick={() => submitInject(j.job_id)} disabled={!injectMessage.trim()}>
                          Send instruction
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>


        {/* Active */}
        <section>
          <h2 className="text-sm font-medium mb-2">Active processes ({active.length})</h2>
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : active.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              No active processes. Send a chat message or trigger a workflow to see one here.
            </Card>
          ) : (
            <div className="space-y-2">
              {active.map((p) => (
                <Card key={p.process_id} className="p-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline">{TYPE_LABELS[p.process_type] || p.process_type}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.current_step || "running…"}
                      </p>
                    </div>
                    <Badge variant={STATUS_TONE[p.status] || "outline"}>{p.status}</Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDuration(now - p.started_at)}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <Button size="sm" variant="outline" onClick={() => openTrace(p)}>
                      <Eye className="h-3 w-3" /> View
                    </Button>
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
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Queue */}
        <section>
          <h2 className="text-sm font-medium mb-2">Queue</h2>
          <Card className="p-4 text-sm text-muted-foreground">
            <Clock className="inline h-3.5 w-3.5 mr-1" />
            Queueing of background jobs lands with long-running jobs in V5.5. For now, scheduled
            tasks and monitor checks appear directly under Active when they start.
          </Card>
        </section>

        {/* History */}
        <section>
          <h2 className="text-sm font-medium mb-2">Recent history ({history.length})</h2>
          {history.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">No completed processes yet.</Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs border-b">
                    <th className="px-3 py-2">Type</th>
                    <th>Name</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => (
                    <tr key={p.process_id} className="border-b last:border-0">
                      <td className="px-3 py-2"><Badge variant="outline">{TYPE_LABELS[p.process_type] || p.process_type}</Badge></td>
                      <td className="max-w-xs truncate">{p.display_name}</td>
                      <td className="text-xs text-muted-foreground">{new Date(p.started_at).toLocaleString()}</td>
                      <td className="text-xs">{p.completed_at ? formatDuration(p.completed_at - p.started_at) : "—"}</td>
                      <td><Badge variant={STATUS_TONE[p.status] || "outline"}>{p.status}</Badge></td>
                      <td className="text-right pr-3">
                        <Button size="sm" variant="ghost" onClick={() => openTrace(p)}>
                          <Eye className="h-3 w-3" /> Log
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      </div>

      {/* Trace side panel */}
      {traceProc && (
        <aside className="w-[420px] border-l flex flex-col bg-muted/10">
          <div className="border-b px-4 py-2 flex items-center gap-2">
            <p className="text-sm font-medium flex-1 truncate">{traceProc.display_name}</p>
            <Badge variant={STATUS_TONE[traceProc.status] || "outline"}>{traceProc.status}</Badge>
            <button onClick={closeTrace} aria-label="Close trace">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1.5">
            {traceEvents.length === 0 ? (
              <p className="text-muted-foreground">Waiting for events…</p>
            ) : (
              traceEvents.map((e, i) => (
                <div key={i} className="border-l-2 border-muted-foreground/20 pl-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-muted-foreground">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline">{e.event_type}</Badge>
                    {e.duration_ms !== undefined && (
                      <span className="text-muted-foreground">{e.duration_ms}ms</span>
                    )}
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
