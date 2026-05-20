import { NextResponse } from "next/server";
import { listMcpTools, listMcpServers } from "@/lib/db/mcp";

export const runtime = "nodejs";

export async function GET() {
  const servers = new Map(listMcpServers().map((s) => [s.id, s.name]));
  return NextResponse.json({
    tools: listMcpTools().map((t) => ({
      id: t.id,
      server_id: t.server_id,
      server_name: servers.get(t.server_id) || "unknown",
      name: t.tool_name,
      description: t.description,
      tier: t.tier,
      call_count: t.call_count,
      last_called_at: t.last_called_at,
    })),
  });
}
