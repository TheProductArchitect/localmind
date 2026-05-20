import { NextRequest, NextResponse } from "next/server";
import { probeMcpServer } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { url, transport, command } = await req.json();
  const result = await probeMcpServer({ url, transport, command });
  return NextResponse.json(result);
}
