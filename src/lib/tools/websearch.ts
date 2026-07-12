import type { Tool } from "./types";

export type SearchHit = { title: string; url: string; description: string };

function renderHits(hits: SearchHit[]): string {
  return hits.map((r) => `- ${r.title}\n  ${r.url}\n  ${r.description}`).join("\n\n");
}

// --- you.com search API (Feature C1) ---
// LLM-ready web search. Only the query leaves the machine (same egress profile
// as Brave), so local-first is preserved; it's opt-in and keyed.
export async function youSearch(q: string, key: string, count = 5): Promise<SearchHit[]> {
  const r = await fetch("https://api.you.com/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: q, count }),
  });
  if (!r.ok) throw new Error(`you.com ${r.status}`);
  const j = (await r.json()) as any;
  // Be defensive about the response shape across API revisions.
  const raw: any[] = j.hits || j.results || j.web?.results || [];
  return raw.slice(0, count).map((x: any) => ({
    title: x.title || x.name || "",
    url: x.url || x.link || "",
    description:
      x.description ||
      x.snippet ||
      (Array.isArray(x.snippets) ? x.snippets[0] : "") ||
      "",
  }));
}

async function braveSearch(q: string, key: string): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`;
  const r = await fetch(url, { headers: { "X-Subscription-Token": key, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const j = (await r.json()) as any;
  return (j.web?.results || []).slice(0, 5).map((x: any) => ({
    title: x.title,
    url: x.url,
    description: x.description,
  }));
}

async function duckduckgoSearch(q: string): Promise<SearchHit[]> {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) LocalMind/2.0" },
  });
  const html = await r.text();
  const results: SearchHit[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const strip = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'")
     .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const snippets: string[] = [];
  for (let m; (m = snipRe.exec(html)) && snippets.length < 8; ) snippets.push(strip(m[1]));
  for (let m; (m = linkRe.exec(html)) && results.length < 5; ) {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ title: strip(m[2]), url, description: snippets[results.length] || "" });
  }
  return results;
}

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

    // Resolve the configured backend. "auto" keeps prior behavior.
    const { getSettings } = await import("../db/queries");
    const { getApiKey } = await import("../db/apikeys");
    const provider = getSettings().web_search_provider || "auto";
    const braveKey = process.env.BRAVE_API_KEY || null;
    const youKey = getApiKey("you");

    try {
      let hits: SearchHit[] = [];
      if (provider === "you" && youKey) {
        hits = await youSearch(q, youKey);
      } else if (provider === "brave" && braveKey) {
        hits = await braveSearch(q, braveKey);
      } else if (provider === "duckduckgo") {
        hits = await duckduckgoSearch(q);
      } else {
        // auto (or selected provider with no key): prefer you.com if keyed,
        // then Brave, then DuckDuckGo HTML.
        if (youKey) hits = await youSearch(q, youKey);
        else if (braveKey) hits = await braveSearch(q, braveKey);
        else hits = await duckduckgoSearch(q);
      }

      if (hits.length === 0) {
        return {
          ok: true,
          output: `No results found for "${q}". Tell the user the search came up empty — do not guess. Suggest rephrasing or reading a specific site with read_secure_webpage.`,
          summary: `searched "${q}" — 0 results`,
        };
      }
      return {
        ok: true,
        output: renderHits(hits),
        summary: `searched "${q}" — ${hits.length} results`,
      };
    } catch (e: any) {
      return { ok: false, output: `Search failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
