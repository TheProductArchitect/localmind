/**
 * First-class alias for the Secure Browser MCP's page reader.
 *
 * Models (and our own tools like web_research) are told to call
 * `read_secure_webpage`. The MCP registers that tool under a longer name
 * (`mcp_builtin-secure-browser_read_secure_webpage`). Without this alias
 * the model falls back to web_search + filesystem and never actually
 * fetches a URL.
 */
import type { Tool } from "./types";
import { getMcpTools } from "./mcp";

export const SECURE_BROWSER_MCP_NAME = "mcp_builtin-secure-browser_read_secure_webpage";

export async function resolveSecureWebpageReader(): Promise<Tool | undefined> {
  const mcp = await getMcpTools().catch(() => []);
  return mcp.find((t) => t.definition.name === SECURE_BROWSER_MCP_NAME);
}

export const readSecureWebpageTool: Tool = {
  actionType: "web_search",
  forcedTier: "allow",
  preview: (i) => `Read page: ${i.url}`,
  version: "1",
  cacheable: (i) => !i.fresh,
  definition: {
    name: "read_secure_webpage",
    description:
      "Fetch a URL through the Secure Browser: sanitize HTML, strip scripts/trackers, convert to Markdown, and scan for prompt injection. Prefer this for any concrete https?:// URL the user asks you to open, download, or summarize. Never use filesystem for web URLs.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full http(s) URL to read" },
        fresh: { type: "boolean", description: "Bypass any page cache when true" },
      },
      required: ["url"],
    },
  },
  async execute(input, ctx) {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return {
        ok: false,
        output: "A valid http(s) URL is required. Do not pass local file paths here — use filesystem for those.",
        summary: "invalid url",
      };
    }
    const reader = await resolveSecureWebpageReader();
    if (!reader) {
      return {
        ok: false,
        output:
          "Secure Browser is not available. Open Fleet → MCP, bootstrap Secure Browser, and ensure it is enabled — then retry.",
        summary: "secure browser offline",
      };
    }
    const result = await reader.execute({ ...input, url }, ctx);
    // MCP sometimes returns ok:true with an [ERROR] body (e.g. missing
    // Playwright binary). Treat that as a hard failure so it never lands
    // in the tool_call_cache and poisons later reads of the same URL.
    if (
      result.ok &&
      /^\s*\[ERROR\]/i.test(result.output)
    ) {
      return {
        ok: false,
        output: result.output,
        summary: result.summary || "secure browser error",
      };
    }
    return result;
  },
};
