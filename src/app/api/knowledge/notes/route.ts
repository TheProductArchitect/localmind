import { NextRequest, NextResponse } from "next/server";
import { listNotes, createNote } from "@/lib/db/knowledge";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ notes: listNotes() });
}

export async function POST(req: NextRequest) {
  const { title, content, tags } = await req.json();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  return NextResponse.json({ note: createNote({ title, content, tags }) });
}
