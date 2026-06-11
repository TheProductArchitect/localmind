import { NextRequest, NextResponse } from "next/server";
import { addMcpServer, listMcpServers, listMcpTools } from "@/lib/db/mcp";
import { getServerHealth, refreshServerTools } from "@/lib/tools/mcp";
import { BUILTIN_MCP_SERVERS, isBuiltinBootstrapped, getAutoBootstrapStatus } from "@/lib/mcp/builtins";

export const runtime = "nodejs";

export async function GET() {
  const servers = listMcpServers();
  const builtinById = new Map(BUILTIN_MCP_SERVERS.map((b) => [b.id, b]));
  return NextResponse.json({
    servers: servers.map((s) => {
      const spec = builtinById.get(s.id);
      const needsBootstrap = !!(spec && spec.relativeBootstrap && !isBuiltinBootstrapped(spec));
      const h = getServerHealth(s.id);
      // First-touch connect: any enabled, bootstrap-clean server that has
      // never been connected and isn't currently mid-connect gets a
      // background sweep. Without this the row sits on "disconnected"
      // until the user clicks Restart, which the user (correctly) calls
      // out as stale state.
      if (s.enabled && !needsBootstrap && h.status === "disconnected" && !s.last_connected_at) {
        refreshServerTools(s).catch(() => {});
      }
      const auto = spec ? getAutoBootstrapStatus(s.id) : { state: "idle" as const, log: "" };
      return {
        ...s,
        env_encrypted: undefined,
        health: getServerHealth(s.id),
        needs_bootstrap: needsBootstrap,
        auto_bootstrap: auto,
        tools: listMcpTools(s.id).map((t) => ({
          id: t.id, name: t.tool_name, description: t.description, tier: t.tier, call_count: t.call_count,
        })),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const server = addMcpServer({
    name: body.name,
    url: body.url || "",
    description: body.description,
    tier: body.tier,
    transport: body.transport,
    command: body.command,
    env: body.env,
    source: body.source || "manual",
    allowlist: body.allowlist,
  });
  await refreshServerTools(server);
  return NextResponse.json({ server });
}
