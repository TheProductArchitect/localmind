import { NextRequest, NextResponse } from "next/server";
import { setTaskEnabled, deleteTask } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { enabled } = await req.json();
  if (typeof enabled === "boolean") setTaskEnabled(params.id, enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  deleteTask(params.id);
  return NextResponse.json({ ok: true });
}
