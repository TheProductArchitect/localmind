"use client";
import { useEffect, useRef } from "react";

// Generalized D3 force graph (§12.6). D3 is loaded from CDN at runtime so it
// never enters the server bundle — the same pattern as note-graph.tsx.
// `kind` drives node color; `source` styling (dashed ring) marks unconfirmed
// inferred nodes so the user can see what Sora derived vs. what they stated.

export type FGNode = { id: string; label: string; kind?: string; source?: string };
export type FGLink = { source: string; target: string; type?: string };

const KIND_COLOR: Record<string, string> = {
  user: "hsl(43 96% 56%)",
  goal: "hsl(217 91% 60%)",
  need: "hsl(0 84% 60%)",
  project: "hsl(262 83% 66%)",
  person: "hsl(330 81% 60%)",
  commitment: "hsl(24 95% 53%)",
  preference: "hsl(160 84% 39%)",
  interest: "hsl(199 89% 48%)",
  resource: "hsl(215 20% 65%)",
  entity: "hsl(215 20% 65%)",
};

export function ForceGraph({
  data,
  onSelect,
  height = 520,
}: {
  data: { nodes: FGNode[]; links: FGLink[] } | null;
  onSelect?: (node: FGNode) => void;
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!data || !ref.current) return;
    const svgEl = ref.current;
    let simulation: any;
    let cancelled = false;

    const loadD3 = (): Promise<any> =>
      new Promise((resolve, reject) => {
        if ((window as any).d3) return resolve((window as any).d3);
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
        s.onload = () => resolve((window as any).d3);
        s.onerror = reject;
        document.head.appendChild(s);
      });

    loadD3().then((d3) => {
      if (cancelled) return;
      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();
      const width = svgEl.clientWidth || 700;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const nodes = data.nodes.map((n) => ({ ...n }));
      const links = data.links.map((l) => ({ ...l }));

      simulation = d3
        .forceSimulation(nodes)
        .force("link", d3.forceLink(links).id((d: any) => d.id).distance(90))
        .force("charge", d3.forceManyBody().strength(-160))
        .force("center", d3.forceCenter(width / 2, height / 2));

      const link = svg.append("g").attr("stroke", "#888").attr("stroke-opacity", 0.4)
        .selectAll("line").data(links).join("line");

      const node = svg.append("g").selectAll("circle").data(nodes).join("circle")
        .attr("r", (d: any) => (d.kind === "user" ? 14 : 8))
        .attr("fill", (d: any) => KIND_COLOR[d.kind] || KIND_COLOR.resource)
        .attr("stroke", (d: any) => (d.source === "inferred" ? "hsl(0 0% 100% / 0.85)" : "none"))
        .attr("stroke-dasharray", (d: any) => (d.source === "inferred" ? "2,2" : null))
        .attr("stroke-width", (d: any) => (d.source === "inferred" ? 1.5 : 0))
        .style("cursor", onSelect ? "pointer" : "default")
        .on("click", (_: any, d: any) => onSelect?.(d));

      const label = svg.append("g").selectAll("text").data(nodes).join("text")
        .text((d: any) => String(d.label || "").slice(0, 24))
        .attr("font-size", (d: any) => (d.kind === "user" ? 12 : 10))
        .attr("dx", 14).attr("dy", 4).attr("fill", "currentColor");

      simulation.on("tick", () => {
        link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
        node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
        label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
      });
    });

    return () => {
      cancelled = true;
      try { simulation?.stop(); } catch {}
      svgEl.innerHTML = "";
    };
  }, [data, onSelect, height]);

  return <svg ref={ref} className="w-full" style={{ height }} />;
}
