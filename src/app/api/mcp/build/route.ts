import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { generateServerCode, type BuilderServer } from "@/lib/mcp-builder";
import { MCP_SERVERS_DIR, ensureDataDir } from "@/lib/paths";
import { addMcpServer } from "@/lib/db/mcp";
import { refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { action, server } = (await req.json()) as { action: string; server: BuilderServer };
  if (!server?.name || !server.tools?.length) {
    return NextResponse.json({ error: "Server name and at least one tool are required" }, { status: 400 });
  }
  const code = generateServerCode(server);

  if (action === "preview") {
    return NextResponse.json({ code });
  }

  // Save and register.
  ensureDataDir();
  const dir = path.join(MCP_SERVERS_DIR, "custom");
  fs.mkdirSync(dir, { recursive: true });
  const slug = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = path.join(dir, `${slug}.mjs`);
  fs.writeFileSync(file, code, { mode: 0o755 });

  const record = addMcpServer({
    name: server.name,
    url: "",
    description: server.description,
    tier: "ask",
    transport: "stdio",
    command: `node ${file}`,
    source: "builder",
  });
  const result = await refreshServerTools(record);
  return NextResponse.json({ server: record, file, connected: result.ok, error: result.error });
}
