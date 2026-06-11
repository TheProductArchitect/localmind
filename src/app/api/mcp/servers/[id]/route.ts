import { NextRequest, NextResponse } from "next/server";
import { deleteMcpServer, getMcpServer, setMcpEnabled, setMcpAllowlist } from "@/lib/db/mcp";
import { refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { enabled, allowlist } = await req.json();
  if (typeof enabled === "boolean") {
    setMcpEnabled(params.id, enabled);
    // Enabling a server should kick a connect attempt — otherwise the UI
    // sits on "disconnected" until something else triggers a tool sweep.
    // Fire-and-forget; refreshServerTools updates the in-memory health map
    // and a follow-up GET picks up the new status.
    if (enabled) {
      const row = getMcpServer(params.id);
      if (row) refreshServerTools(row).catch(() => {});
    }
  }
  if (Array.isArray(allowlist)) setMcpAllowlist(params.id, allowlist);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const server = getMcpServer(params.id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (server.builtin) {
    return NextResponse.json(
      { error: "Cannot delete a built-in MCP server. Disable it instead." },
      { status: 400 }
    );
  }
  deleteMcpServer(params.id);
  return NextResponse.json({ ok: true });
}
