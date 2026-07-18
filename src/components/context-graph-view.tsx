"use client";
/**
 * <ContextGraphView/> — the User Context Graph (Feature H), embeddable.
 *
 * Lives as the "Context" tab inside /knowledge ("what Sora knows" + "what Sora
 * knows about you" on one page). A user-rooted force graph of goals,
 * preferences, people, and topics, assembled from goals + memory + the Brain.
 * Read-only in phase 1; per-user scoped; nothing leaves the machine.
 */
import { useCallback, useEffect, useState } from "react";
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

export function ContextGraphView() {
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

  const onSelect = useCallback((n: FGNode) => setSelected(n), []);

  const kinds = graph ? ([...new Set(graph.nodes.map((n) => n.kind).filter(Boolean))] as string[]) : [];
  const filtered: Graph | null = graph
    ? kindFilter
      ? { nodes: graph.nodes.filter((n) => n.kind === kindFilter || n.kind === "user"), links: graph.links }
      : graph
    : null;
  const meaningful = graph && graph.nodes.length > 1;

  return (
    <div>
      <p className="lm-body mb-6" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
        What Sora understands about <em>you</em> — goals, preferences, people, and topics — assembled
        from your goals, memory, and Brain. It fills in as you talk to Sora. Nothing here leaves your machine.
      </p>

      {kinds.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <button
            onClick={() => setKindFilter(null)}
            className={`text-xs px-2 py-1 rounded-full border ${!kindFilter ? "bg-white/10 border-white/20" : "border-transparent text-white/50 hover:bg-white/5"}`}
          >All</button>
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
              className={`text-xs px-2 py-1 rounded-full border ${kindFilter === k ? "bg-white/10 border-white/20" : "border-transparent text-white/50 hover:bg-white/5"}`}
            >{KIND_LABEL[k] || k}</button>
          ))}
        </div>
      )}

      {!meaningful ? (
        <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
          Your context graph is empty. As you set goals, tell Sora what you prefer, and build up your
          Brain, this fills in with what she understands about you.
        </p>
      ) : (
        <div className="lm-surface-1" style={{ padding: 12, borderRadius: 14 }}>
          <ForceGraph data={filtered} onSelect={onSelect} height={460} />
        </div>
      )}

      {selected && (
        <div className="lm-surface-1 mt-4" style={{ padding: 16, borderRadius: 14 }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="lm-chip">{KIND_LABEL[selected.kind || ""] || selected.kind}</span>
            {selected.source === "inferred" && <span className="lm-chip" style={{ color: "hsl(38 92% 60%)", borderColor: "hsl(38 92% 60% / 0.4)" }}>Sora inferred this</span>}
            {selected.source === "stated" && <span className="lm-chip">You stated this</span>}
            <button className="ml-auto text-white/40 hover:text-white/80" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.9)" }}>{selected.label}</p>
          <p className="lm-micro mt-3" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.4)" }}>
            Editing and confirming context nodes lands with the ingestion phase. For now this is a
            read-only view assembled from your goals, memory, and Brain.
          </p>
        </div>
      )}
    </div>
  );
}
