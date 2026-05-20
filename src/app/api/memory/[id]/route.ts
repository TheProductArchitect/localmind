import { NextRequest, NextResponse } from "next/server";
import { deleteMemory, getMemory } from "@/lib/db/queries";
import { currentUser, isOwner } from "@/lib/auth/identity";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = currentUser(req);
  const item = getMemory(params.id);
  if (!user || !item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.user_id && item.user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteMemory(params.id);
  return NextResponse.json({ ok: true });
}
