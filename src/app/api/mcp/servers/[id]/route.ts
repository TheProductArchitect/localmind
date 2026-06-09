import { NextRequest, NextResponse } from "next/server";
import { deleteMcpServer, getMcpServer, setMcpEnabled, setMcpAllowlist } from "@/lib/db/mcp";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { enabled, allowlist } = await req.json();
  if (typeof enabled === "boolean") setMcpEnabled(params.id, enabled);
  if (Array.isArray(allowlist)) setMcpAllowlist(params.id, allowlist);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  if (!getMcpServer(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteMcpServer(params.id);
  return NextResponse.json({ ok: true });
}
