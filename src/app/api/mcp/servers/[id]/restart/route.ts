import { NextRequest, NextResponse } from "next/server";
import { getMcpServer } from "@/lib/db/mcp";
import { refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const server = getMcpServer(params.id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await refreshServerTools(server);
  return NextResponse.json(result);
}
