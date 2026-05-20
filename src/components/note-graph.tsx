"use client";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";

// D3 force-directed note graph. D3 is loaded from CDN at runtime so it never
// enters the server bundle. The simulation runs only while this view is mounted.
export function NoteGraph({ onOpenNote }: { onOpenNote: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<{ nodes: any[]; links: any[] } | null>(null);

  useEffect(() => {
    fetch("/api/knowledge/notes/graph").then((r) => r.json()).then(setData).catch(() => setData({ nodes: [], links: [] }));
  }, []);

  useEffect(() => {
    if (!data || data.links.length === 0 || !ref.current) return;
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
      if (cancelled || !ref.current) return;
      const svg = d3.select(ref.current);
      svg.selectAll("*").remove();
      const width = ref.current.clientWidth || 600;
      const height = 480;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const nodes = data.nodes.map((n) => ({ ...n }));
      const links = data.links.map((l) => ({ ...l }));

      simulation = d3
        .forceSimulation(nodes)
        .force("link", d3.forceLink(links).id((d: any) => d.id).distance(80))
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2));

      const link = svg.append("g").attr("stroke", "#999").attr("stroke-opacity", 0.5)
        .selectAll("line").data(links).join("line");

      const node = svg.append("g").selectAll("circle").data(nodes).join("circle")
        .attr("r", (d: any) => 8 + Math.min(12, d.inbound * 3))
        .attr("fill", "hsl(217 91% 60%)")
        .style("cursor", "pointer")
        .on("click", (_: any, d: any) => onOpenNote(d.id));

      const label = svg.append("g").selectAll("text").data(nodes).join("text")
        .text((d: any) => d.title.slice(0, 20))
        .attr("font-size", 10).attr("dx", 12).attr("dy", 4).attr("fill", "currentColor");

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
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [data, onOpenNote]);

  if (data && data.links.length < 1) {
    return (
      <EmptyState
        title="No linked notes yet"
        hint="Link notes with [[Note title]] syntax. Once notes reference each other, the graph appears here."
      />
    );
  }
  return <svg ref={ref} className="w-full" style={{ height: 480 }} />;
}
