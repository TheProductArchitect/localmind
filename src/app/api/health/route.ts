import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Liveness probe — public, used by the backup-restore reconnect flow.
export async function GET() {
  return NextResponse.json({ status: "ok", uptime: process.uptime(), ts: Date.now() });
}
