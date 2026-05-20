import { NextRequest, NextResponse } from "next/server";
import { startTunnel, getTunnelUrl } from "@/lib/comms/tunnel";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ url: getTunnelUrl() });
}

export async function POST(_req: NextRequest) {
  const result = await startTunnel();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
