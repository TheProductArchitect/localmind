import { NextRequest, NextResponse } from "next/server";
import { deleteOllamaModel } from "@/lib/providers/ollama";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    await deleteOllamaModel(decodeURIComponent(params.name));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
