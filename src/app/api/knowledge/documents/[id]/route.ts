import { NextRequest, NextResponse } from "next/server";
import { deleteDocument } from "@/lib/db/knowledge";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  deleteDocument(params.id);
  return NextResponse.json({ ok: true });
}
