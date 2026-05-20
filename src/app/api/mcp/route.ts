import { NextRequest, NextResponse } from "next/server";
import { addMcpServer, deleteMcpServer, listMcpServers, setMcpEnabled } from "@/lib/db/mcp";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ servers: listMcpServers() });
}

export async function POST(req: NextRequest) {
  const { name, url, description, tier, transport, command, env } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const server = addMcpServer({ name, url: url || "", description, tier, transport, command, env });
  return NextResponse.json({ server });
}

export async function PATCH(req: NextRequest) {
  const { id, enabled } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  setMcpEnabled(id, !!enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteMcpServer(id);
  return NextResponse.json({ ok: true });
}
