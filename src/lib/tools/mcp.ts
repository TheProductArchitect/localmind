import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  listMcpServers, listMcpTools, syncMcpTools, markConnected, bumpMcpToolUsage,
  getMcpEnv, type McpServer,
} from "../db/mcp";
import type { Tool } from "./types";

export type ServerHealth = {
  status: "connected" | "connecting" | "disconnected" | "error";
  toolCount: number;
  calls24h: number;
  errors: number;
  avgMs: number;
  lastError: string | null;
  lastCallAt: number | null;
};

const health = new Map<string, ServerHealth>();

export function getServerHealth(id: string): ServerHealth {
  return health.get(id) || {
    status: "disconnected", toolCount: 0, calls24h: 0, errors: 0, avgMs: 0, lastError: null, lastCallAt: null,
  };
}

function recordCall(id: string, ms: number, ok: boolean, err?: string) {
  const h = getServerHealth(id);
  h.calls24h++;
  h.lastCallAt = Date.now();
  h.avgMs = Math.round((h.avgMs * (h.calls24h - 1) + ms) / h.calls24h);
  if (!ok) { h.errors++; h.lastError = err || "unknown"; }
  health.set(id, h);
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: "localmind", version: "2.0.0" }, { capabilities: {} });
  if (server.transport === "stdio" && server.command) {
    const [cmd, ...args] = server.command.split(" ");
    const { getProxyEnv } = await import("../mcp-proxy");
    const transport = new StdioClientTransport({
      command: cmd,
      args,
      // Route the child's outbound traffic through the allowlist proxy.
      env: { ...process.env, ...getMcpEnv(server), ...getProxyEnv() } as Record<string, string>,
    });
    await client.connect(transport);
  } else {
    await client.connect(new SSEClientTransport(new URL(server.url)));
  }
  return client;
}

export async function probeMcpServer(opts: { url?: string; transport?: string; command?: string }): Promise<{
  ok: boolean;
  tools?: { name: string; description?: string }[];
  error?: string;
}> {
  try {
    const fake = {
      transport: (opts.transport || "sse") as any,
      command: opts.command || null,
      url: opts.url || "",
      env_encrypted: null,
    } as McpServer;
    const client = await connect(fake);
    const res = await client.listTools();
    await client.close();
    return { ok: true, tools: res.tools.map((t) => ({ name: t.name, description: t.description })) };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not connect" };
  }
}

export async function refreshServerTools(server: McpServer): Promise<{ ok: boolean; error?: string }> {
  // Flip to "connecting" so the UI shows a live in-flight indicator instead
  // of leaving a stale "disconnected" badge while the spawn + handshake
  // happens. Cleared by the success/failure branches below.
  {
    const h = getServerHealth(server.id);
    h.status = "connecting";
    h.lastError = null;
    health.set(server.id, h);
  }
  try {
    const client = await connect(server);
    const res = await client.listTools();
    await client.close();
    syncMcpTools(server.id, server.tier, res.tools.map((t) => ({
      name: t.name, description: t.description, schema: t.inputSchema,
    })));
    markConnected(server.id);
    const h = getServerHealth(server.id);
    h.status = "connected";
    h.toolCount = res.tools.length;
    h.lastError = null;
    health.set(server.id, h);
    return { ok: true };
  } catch (e: any) {
    const h = getServerHealth(server.id);
    h.status = "error";
    h.lastError = e?.message || "connect failed";
    health.set(server.id, h);
    return { ok: false, error: e?.message };
  }
}

export async function getMcpTools(): Promise<Tool[]> {
  const servers = listMcpServers().filter((s) => s.enabled);
  const tools: Tool[] = [];
  const toolRows = listMcpTools();
  const tierByKey = new Map(toolRows.map((t) => [`${t.server_id}:${t.tool_name}`, t.tier]));

  for (const server of servers) {
    let serverTools = toolRows.filter((t) => t.server_id === server.id);
    if (serverTools.length === 0) {
      // Never block the chat hot path on MCP cold-connect. Refresh in the
      // background so tools appear on a later turn.
      void refreshServerTools(server).catch(() => {});
      continue;
    }
    for (const mt of serverTools) {
      tools.push({
        actionType: `mcp:${server.id}`,
        forcedTier: (tierByKey.get(`${server.id}:${mt.tool_name}`) as any) || server.tier,
        preview: (i) => `${server.name} → ${mt.tool_name}: ${JSON.stringify(i).slice(0, 160)}`,
        definition: {
          name: `mcp_${server.id}_${mt.tool_name}`,
          description: `[${server.name}] ${mt.description || mt.tool_name}`,
          parameters: (() => {
            try { return JSON.parse(mt.parameter_schema || "{}"); }
            catch { return { type: "object", properties: {} }; }
          })(),
        },
        async execute(input) {
          const started = Date.now();
          // Web-guard interception for the built-in Secure Browser: enforce
          // kill switch + site grants + sensitive-context blindness before
          // the child process sees the URL, and pass the domain's standing
          // grant down so the MCP can release password-field pages only for
          // explicitly-allowed sites.
          if (server.id === "builtin-secure-browser" && typeof input.url === "string") {
            const { checkWebAccess, auditPageRead } = await import("../agent/web-guard");
            const access = checkWebAccess(input.url);
            if (!access.ok) {
              recordCall(server.id, 0, false, "blocked by web guard");
              return { ok: false, output: access.reason, summary: "blocked by web guard" };
            }
            input = { ...input, allow_sensitive: access.allowSensitive };
            auditPageRead("read_secure_webpage", input.url);
          }
          try {
            const client = await connect(server);
            // Secure Browser needs headroom beyond the SDK's 60s default:
            // cold spawn loads the injection-scanner model (~10-20s on CPU)
            // before the page fetch even starts.
            const callTimeout = server.id === "builtin-secure-browser" ? 120_000 : undefined;
            const result: any = await client.callTool(
              { name: mt.tool_name, arguments: input },
              undefined,
              callTimeout ? { timeout: callTimeout } : undefined
            );
            await client.close();
            bumpMcpToolUsage(server.id, mt.tool_name);
            const text = (result.content || [])
              .map((b: any) => (b.type === "text" ? b.text : JSON.stringify(b)))
              .join("\n");
            recordCall(server.id, Date.now() - started, !result.isError);
            return { ok: !result.isError, output: text || "(no output)", summary: `${server.name}/${mt.tool_name}` };
          } catch (e: any) {
            recordCall(server.id, Date.now() - started, false, e?.message);
            return { ok: false, output: `MCP tool failed: ${e?.message || "unknown"}`, summary: "failed" };
          }
        },
      });
    }
  }
  return tools;
}
