import { NextRequest, NextResponse } from "next/server";
import { setTaskEnabled, deleteTask } from "@/lib/db/automations";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { enabled } = await req.json();
  if (typeof enabled === "boolean") setTaskEnabled(params.id, enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  deleteTask(params.id);
  return NextResponse.json({ ok: true });
}
