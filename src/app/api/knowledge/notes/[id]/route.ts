import { NextRequest, NextResponse } from "next/server";
import { updateNote, deleteNote, getNote } from "@/lib/db/knowledge";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const body = await req.json();
  updateNote(params.id, body);
  return NextResponse.json({ note: getNote(params.id) });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  deleteNote(params.id);
  return NextResponse.json({ ok: true });
}
