import { NextRequest, NextResponse } from "next/server";
import { addMcpServer, listMcpServers, listMcpTools } from "@/lib/db/mcp";
import { getServerHealth, refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function GET() {
  const servers = listMcpServers();
  return NextResponse.json({
    servers: servers.map((s) => ({
      ...s,
      env_encrypted: undefined,
      health: getServerHealth(s.id),
      tools: listMcpTools(s.id).map((t) => ({
        id: t.id, name: t.tool_name, description: t.description, tier: t.tier, call_count: t.call_count,
      })),
    })),
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
