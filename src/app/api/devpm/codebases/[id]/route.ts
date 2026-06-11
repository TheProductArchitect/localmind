import { NextRequest, NextResponse } from "next/server";
import { deleteCodebase, setCodebaseCommands } from "@/lib/db/devpm";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { commands } = await req.json();
  if (Array.isArray(commands)) setCodebaseCommands(params.id, commands);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  deleteCodebase(params.id);
  return NextResponse.json({ ok: true });
}
