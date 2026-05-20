import { NextRequest, NextResponse } from "next/server";
import { REGISTRY } from "@/lib/mcp-registry";
import { addMcpServer } from "@/lib/db/mcp";
import { refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ registry: REGISTRY });
}

export async function POST(req: NextRequest) {
  // One-click install: register the registry entry as a stdio MCP server.
  const { id } = await req.json();
  const entry = REGISTRY.find((e) => e.id === id);
  if (!entry) return NextResponse.json({ error: "Unknown registry entry" }, { status: 404 });

  const tier =
    entry.permissions === "Always Allow" ? "allow" :
    entry.permissions === "Never Without PIN" ? "pin" : "ask";

  const server = addMcpServer({
    name: entry.name,
    url: "",
    description: entry.description,
    tier,
    transport: "stdio",
    command: entry.install.command,
    source: "registry",
  });
  const result = await refreshServerTools(server);
  return NextResponse.json({ server, connected: result.ok, error: result.error });
}
