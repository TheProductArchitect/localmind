import type { Tool } from "./types";
import { websearchTool } from "./websearch";
import { listAllTools } from "./index";

const URL_RE = /https?:\/\/[^\s)]+/gi;

function extractUrls(searchOutput: string, limit: number): string[] {
  const urls = searchOutput.match(URL_RE) || [];
  return [...new Set(urls.map((u) => u.replace(/[.,;]+$/, "")))].slice(0, limit);
}

export const webResearchTool: Tool = {
  actionType: "web_search",
  preview: (i) => `Research: ${i.query}`,
  version: "1",
  cacheable: (i) => !i.fresh,
  definition: {
    name: "web_research",
    description:
      "Search the web and read the top results in one step. Returns a synthesized summary with source URLs. Use for research tasks that need more than snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research question or search query" },
        max_pages: { type: "number", description: "How many top results to read (1-3, default 2)" },
        fresh: { type: "boolean", description: "Skip cache for time-sensitive queries" },
      },
      required: ["query"],
    },
  },
  async execute(input, ctx) {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, output: "Empty query" };

    const maxPages = Math.min(3, Math.max(1, Number(input.max_pages) || 2));

    const searchResult = await websearchTool.execute({ query: q }, ctx);
    if (!searchResult.ok) return searchResult;

    const urls = extractUrls(searchResult.output, maxPages);
    if (urls.length === 0) {
      return {
        ok: true,
        output: `Search results (no readable URLs found):\n\n${searchResult.output}`,
        summary: `researched "${q}" — search only`,
      };
    }

    const allTools = await listAllTools();
    const secureReader = allTools.find((t) => t.definition.name === "read_secure_webpage");

    const sections: string[] = [`# Search results for: ${q}\n`, searchResult.output, "\n# Page contents\n"];

    for (const url of urls) {
      sections.push(`\n## ${url}\n`);
      if (secureReader) {
        const page = await secureReader.execute({ url }, ctx);
        sections.push(page.ok ? page.output.slice(0, 4000) : `(could not read: ${page.output})`);
      } else {
        try {
          const r = await fetch(url, {
            signal: AbortSignal.timeout(10000),
            headers: { "User-Agent": "LocalMind/1.0 (research)" },
          });
          const html = await r.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 3000);
          sections.push(text || "(empty page)");
        } catch (e: any) {
          sections.push(`(fetch failed: ${e?.message || "unknown"})`);
        }
      }
    }

    return {
      ok: true,
      output: sections.join("\n"),
      summary: `researched "${q}" — ${urls.length} page(s)`,
    };
  },
};
