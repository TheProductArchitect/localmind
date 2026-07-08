import type { Tool } from "./types";

export const websearchTool: Tool = {
  actionType: "web_search",
  preview: (i) => `Search: ${i.query}`,
  version: "1",
  // Searches are functionally deterministic for the same query within minutes;
  // the V6 tool_call_cache LRU bounds staleness via natural eviction. If the
  // user wants fresh results, they can use a slightly different query (which
  // changes the input hash).
  cacheable: () => true,
  definition: {
    name: "web_search",
    description:
      "Discover links matching a query — returns titles, URLs, and snippets only. To read a concrete URL, call read_secure_webpage (or web_research for open-ended questions). Never pass http(s) URLs to filesystem.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  async execute(input) {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, output: "Empty query" };

    // Kill switch covers search too — "sever web access" means all of it.
    const { checkWebAccess } = await import("../agent/web-guard");
    const access = checkWebAccess();
    if (!access.ok) return { ok: false, output: access.reason, summary: "blocked by web guard" };

    const brave = process.env.BRAVE_API_KEY;
    try {
      if (brave) {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`;
        const r = await fetch(url, { headers: { "X-Subscription-Token": brave, Accept: "application/json" } });
        if (!r.ok) throw new Error(`Brave ${r.status}`);
        const j = (await r.json()) as any;
        const results = (j.web?.results || []).slice(0, 5).map((x: any) => ({
          title: x.title, url: x.url, description: x.description,
        }));
        return {
          ok: true,
          output: results.map((r: any) => `- ${r.title}\n  ${r.url}\n  ${r.description}`).join("\n\n"),
          summary: `searched "${q}" — ${results.length} results`,
        };
      }
      // Fallback: DuckDuckGo Instant Answer (limited but works without key)
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
      const j = (await r.json()) as any;
      const related = (j.RelatedTopics || []).slice(0, 5);
      const text = related.map((t: any) => `- ${t.Text}\n  ${t.FirstURL || ""}`).filter(Boolean).join("\n\n");
      return {
        ok: true,
        output: text || `No instant results. Abstract: ${j.AbstractText || "(none)"}`,
        summary: `searched "${q}"`,
      };
    } catch (e: any) {
      return { ok: false, output: `Search failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
