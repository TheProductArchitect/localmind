import { NextRequest, NextResponse } from "next/server";
import { updateNote, deleteNote, getNote } from "@/lib/db/knowledge";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  updateNote(params.id, body);
  return NextResponse.json({ note: getNote(params.id) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  deleteNote(params.id);
  return NextResponse.json({ ok: true });
}
