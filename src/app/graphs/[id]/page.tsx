"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Badge, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { Workflow, ArrowLeft, X, RefreshCw, Zap, Database, Server, AlertTriangle } from "lucide-react";

type TaskGraph = {
  graph_id: string;
  root_goal: string;
  status: string;
  cost_budget: { tokens?: number; wall_seconds?: number };
  cost_actual: { tokens: number; wall_seconds: number; usd: number };
  originating_node_id: string;
  created_at: number;
  completed_at: number | null;
};

type TaskNode = {
  node_id: string;
  graph_id: string;
  parent_ids: string[];
  depends_on: string[];
  agent_spec: {
    persona_id: string;
    tools: string[];
    prompt_template: string;
    requires_verification?: boolean;
  };
  input: Record<string, unknown>;
  input_hash: string;
  contract: { cost_budget: { tokens?: number; wall_seconds?: number }; success_predicate?: string };
  placement: { preferred_node_id?: string };
  status: string;
  output: unknown;
  output_hash: string | null;
  cache_hit_of_node_id: string | null;
  executing_node_id: string | null;
  cost_actual: { tokens: number; wall_seconds: number; usd: number };
  retry_count: number;
  last_error: string | null;
  started_at: number | null;
  completed_at: number | null;
};

const STATUS_TONE: Record<string, "outline" | "success" | "destructive" | "warning"> = {
  pending: "outline",
  scheduled: "warning",
  running: "success",
  done: "success",
  cached: "outline",
  failed: "destructive",
  cancelled: "destructive",
  refuted: "destructive",
  peer_lost: "destructive",
};

function shortId(s: string): string {
  return s.slice(-8);
}

/**
 * Topologically order nodes for display. The DAG renders as an indent tree
 * keyed off depends_on — a node with no deps is depth 0; otherwise its
 * depth is 1 + max(depth of any dependency).
 */
function depthsByNode(nodes: TaskNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.node_id, n] as const));
  const depth = new Map<string, number>();
  function getDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const n = byId.get(id);
    if (!n || n.depends_on.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const dep of n.depends_on) d = Math.max(d, getDepth(dep) + 1);
    depth.set(id, d);
    return d;
  }
  for (const n of nodes) getDepth(n.node_id);
  return depth;
}

export default function GraphDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const graphId = params.id;
  const [graph, setGraph] = useState<TaskGraph | null>(null);
  const [nodes, setNodes] = useState<TaskNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial fetch + SSE attach.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graphs/${graphId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) {
          toast(j.error, "error");
          return;
        }
        setGraph(j.graph);
        setNodes(j.nodes || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

    try {
      const es = new EventSource(`/api/graphs/${graphId}/events`);
      eventSourceRef.current = es;
      es.addEventListener("graph", (e) => {
        try { setGraph(JSON.parse((e as MessageEvent).data) as TaskGraph); } catch { /* ignore */ }
      });
      es.addEventListener("node", (e) => {
        try {
          const upd = JSON.parse((e as MessageEvent).data) as TaskNode;
          setNodes((cur) => {
            const idx = cur.findIndex((n) => n.node_id === upd.node_id);
            if (idx === -1) return [...cur, upd];
            const next = [...cur];
            next[idx] = upd;
            return next;
          });
        } catch { /* ignore */ }
      });
      es.addEventListener("done", () => { es.close(); eventSourceRef.current = null; });
      es.onerror = () => { es.close(); eventSourceRef.current = null; };
    } catch { /* SSE optional */ }

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, [graphId]);

  const depths = useMemo(() => depthsByNode(nodes), [nodes]);
  const orderedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      const da = depths.get(a.node_id) ?? 0;
      const db = depths.get(b.node_id) ?? 0;
      if (da !== db) return da - db;
      return (a.started_at ?? 0) - (b.started_at ?? 0);
    });
  }, [nodes, depths]);

  const selected = nodes.find((n) => n.node_id === selectedNodeId) ?? null;

  async function cancelGraph() {
    if (!graph) return;
    if (!confirm("Cancel this graph? In-flight nodes will finish; pending nodes will be marked cancelled.")) return;
    const r = await fetch(`/api/graphs/${graphId}`, { method: "DELETE" });
    if (r.ok) toast("Cancellation requested", "success");
  }

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!graph) {
    return (
      <div className="p-6 space-y-3">
        <Button size="sm" variant="ghost" onClick={() => router.push("/graphs")}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <Card className="p-4 text-sm text-destructive">Graph not found or no access.</Card>
      </div>
    );
  }

  const tokenPct = graph.cost_budget.tokens
    ? Math.min(100, (graph.cost_actual.tokens / graph.cost_budget.tokens) * 100)
    : 0;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => router.push("/graphs")}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <Workflow className="h-5 w-5" />
          <h1 className="text-xl font-semibold flex-1 truncate">{graph.root_goal}</h1>
          <Badge variant={STATUS_TONE[graph.status] || "outline"}>{graph.status}</Badge>
          {!graph.completed_at && (
            <Button size="sm" variant="ghost" onClick={cancelGraph}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>

        {/* Cost rollup */}
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Tokens</p>
              <p className="font-medium text-sm">
                {graph.cost_actual.tokens.toLocaleString()}
                <span className="text-muted-foreground"> / {graph.cost_budget.tokens?.toLocaleString() ?? "∞"}</span>
              </p>
              {graph.cost_budget.tokens && (
                <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                  <div className={`h-full ${tokenPct > 90 ? "bg-destructive" : tokenPct > 70 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${tokenPct}%` }} />
                </div>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Wall seconds</p>
              <p className="font-medium text-sm">{graph.cost_actual.wall_seconds.toFixed(2)}s</p>
            </div>
            <div>
              <p className="text-muted-foreground">Nodes</p>
              <p className="font-medium text-sm">{nodes.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Originating node</p>
              <p className="font-medium text-sm font-mono truncate">{graph.originating_node_id.slice(0, 14)}…</p>
            </div>
          </div>
        </Card>

        {/* DAG list */}
        <Card className="p-3">
          <p className="text-sm font-medium mb-2">DAG ({nodes.length} nodes)</p>
          {orderedNodes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No nodes yet.</p>
          ) : (
            <div className="space-y-1">
              {orderedNodes.map((n) => {
                const d = depths.get(n.node_id) ?? 0;
                const onPeer = n.executing_node_id && n.executing_node_id !== graph.originating_node_id;
                const isSelected = n.node_id === selectedNodeId;
                return (
                  <button
                    key={n.node_id}
                    onClick={() => setSelectedNodeId(n.node_id)}
                    className={`flex items-center gap-2 w-full text-left rounded px-2 py-1.5 text-sm ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
                    style={{ paddingLeft: `${0.5 + d * 1.25}rem` }}
                  >
                    {d > 0 && <span className="text-muted-foreground">└─</span>}
                    <Badge variant={STATUS_TONE[n.status] || "outline"}>{n.status}</Badge>
                    {n.cache_hit_of_node_id && <Badge variant="outline"><Database className="h-2.5 w-2.5" /> cached</Badge>}
                    {onPeer && <Badge variant="success"><Server className="h-2.5 w-2.5" /> peer</Badge>}
                    {n.agent_spec.requires_verification && <Badge variant="warning">verify</Badge>}
                    {n.retry_count > 0 && <Badge variant="warning">retry × {n.retry_count}</Badge>}
                    <span className="text-xs font-mono text-muted-foreground">{shortId(n.node_id)}</span>
                    <span className="truncate flex-1 text-xs">{n.agent_spec.prompt_template.slice(0, 80)}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {n.cost_actual.tokens}t · {n.cost_actual.wall_seconds.toFixed(1)}s
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Node detail side panel */}
      {selected && (
        <aside className="w-[460px] border-l flex flex-col bg-muted/10 overflow-y-auto">
          <div className="border-b px-4 py-2 flex items-center gap-2 sticky top-0 bg-card">
            <p className="text-sm font-medium flex-1 truncate">Node {shortId(selected.node_id)}</p>
            <Badge variant={STATUS_TONE[selected.status] || "outline"}>{selected.status}</Badge>
            <button onClick={() => setSelectedNodeId(null)} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3 space-y-3 text-xs">
            <Section title="Prompt template">
              <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2">{selected.agent_spec.prompt_template}</pre>
            </Section>
            <Section title="Persona">
              <div>{selected.agent_spec.persona_id}</div>
              {selected.agent_spec.tools.length > 0 && (
                <div className="text-muted-foreground">tools: {selected.agent_spec.tools.join(", ")}</div>
              )}
            </Section>
            <Section title="Input">
              <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 max-h-40 overflow-y-auto">{JSON.stringify(selected.input, null, 2)}</pre>
              <div className="text-muted-foreground text-[10px] font-mono mt-1">hash: {selected.input_hash.slice(0, 24)}…</div>
            </Section>
            {selected.cache_hit_of_node_id && (
              <Section title="Cache hit">
                <div className="flex items-center gap-1 text-green-600">
                  <Database className="h-3 w-3" /> Result reused from {shortId(selected.cache_hit_of_node_id)}
                </div>
              </Section>
            )}
            <Section title="Contract">
              {selected.contract.success_predicate && (
                <div className="text-muted-foreground mb-1">success: {selected.contract.success_predicate}</div>
              )}
              <div className="text-muted-foreground">
                budget: {selected.contract.cost_budget.tokens?.toLocaleString() ?? "—"} tokens
                {", "}
                {selected.contract.cost_budget.wall_seconds ?? "—"}s
              </div>
            </Section>
            <Section title="Placement">
              {selected.placement.preferred_node_id ? (
                <div>preferred: <span className="font-mono">{selected.placement.preferred_node_id.slice(0, 14)}…</span></div>
              ) : (
                <div className="text-muted-foreground">(no preference)</div>
              )}
              {selected.executing_node_id && (
                <div>executed on: <span className="font-mono">{selected.executing_node_id.slice(0, 14)}…</span></div>
              )}
            </Section>
            <Section title="Cost actual">
              <div>{selected.cost_actual.tokens.toLocaleString()} tokens · {selected.cost_actual.wall_seconds.toFixed(2)}s</div>
            </Section>
            {selected.output !== null && (
              <Section title="Output">
                <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 max-h-60 overflow-y-auto">
                  {typeof selected.output === "string" ? selected.output : JSON.stringify(selected.output, null, 2)}
                </pre>
              </Section>
            )}
            {selected.last_error && (
              <Section title="Error">
                <div className="flex items-start gap-1 text-destructive">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{selected.last_error}</span>
                </div>
              </Section>
            )}
            {selected.depends_on.length > 0 && (
              <Section title="Depends on">
                <ul>
                  {selected.depends_on.map((id) => (
                    <li key={id}>
                      <button
                        className="font-mono text-xs hover:underline"
                        onClick={() => setSelectedNodeId(id)}
                      >
                        {shortId(id)}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{title}</p>
      {children}
    </div>
  );
}
