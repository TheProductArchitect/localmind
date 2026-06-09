import { NextRequest, NextResponse } from "next/server";
import { deleteMonitor } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  deleteMonitor(params.id);
  return NextResponse.json({ ok: true });
}
