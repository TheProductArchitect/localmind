"use client";
/**
 * /context — the User Context Graph (Feature H, phase 1).
 *
 * A user-rooted view of what Sora understands about *you* — goals, preferences,
 * people, and topics — assembled from goals + memory + the Brain. Distinct from
 * /ops (which tracks the agent's activity). Read-only in phase 1; ingestion and
 * confirm/edit/delete land as the graph grows (GraphQL is a later phase).
 */
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, EmptyState } from "@/components/ui";
import { ForceGraph, type FGNode } from "@/components/force-graph";

type Graph = { nodes: FGNode[]; links: { source: string; target: string; type?: string }[] };

const KIND_LABEL: Record<string, string> = {
  user: "You",
  goal: "Goal",
  preference: "Preference",
  person: "Person",
  entity: "Entity",
  project: "Project",
  interest: "Interest",
  need: "Need",
};

export default function ContextPage() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<FGNode | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/context/graph")
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], links: [] }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const kinds = graph ? [...new Set(graph.nodes.map((n) => n.kind).filter(Boolean))] as string[] : [];
  const filtered: Graph | null = graph
    ? kindFilter
      ? {
          nodes: graph.nodes.filter((n) => n.kind === kindFilter || n.kind === "user"),
          links: graph.links,
        }
      : graph
    : null;

  const onSelect = useCallback((n: FGNode) => setSelected(n), []);

  const meaningful = graph && graph.nodes.length > 1;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-10 py-14 max-w-5xl">
        <div className="mb-4">
          <p className="lm-micro mb-2">Context</p>
          <h1 className="lm-display">What Sora knows about you</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            A model of your world — goals, preferences, people, and topics — built from your goals,
            memory, and the Brain. It fills in as you talk to Sora. Nothing here leaves your machine.
          </p>
        </div>

        {kinds.length > 0 && (
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            <button
              onClick={() => setKindFilter(null)}
              className={`text-xs px-2 py-1 rounded-full border ${!kindFilter ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:bg-muted/50"}`}
            >All</button>
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(kindFilter === k ? null : k)}
                className={`text-xs px-2 py-1 rounded-full border ${kindFilter === k ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:bg-muted/50"}`}
              >{KIND_LABEL[k] || k}</button>
            ))}
          </div>
        )}

        {!meaningful ? (
          <EmptyState
            title="Your context graph is empty"
            hint="As you set goals, tell Sora what you prefer, and build up your Brain, this graph fills in with what she understands about you."
          />
        ) : (
          <Card className="p-2">
            <ForceGraph data={filtered} onSelect={onSelect} />
          </Card>
        )}
      </div>

      {selected && (
        <aside className="w-[360px] border-l flex flex-col bg-muted/10">
          <div className="border-b px-4 py-3 flex items-center gap-2">
            <p className="text-sm font-medium flex-1 truncate">{selected.label}</p>
            <button onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{KIND_LABEL[selected.kind || ""] || selected.kind}</Badge>
              {selected.source === "inferred" && <Badge variant="warning">Sora inferred this</Badge>}
              {selected.source === "stated" && <Badge variant="outline">You stated this</Badge>}
            </div>
            <p className="text-muted-foreground">{selected.label}</p>
            <p className="text-xs text-muted-foreground">
              Editing and confirming context nodes lands with the ingestion phase. For now this is a
              read-only view assembled from your goals, memory, and Brain.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
