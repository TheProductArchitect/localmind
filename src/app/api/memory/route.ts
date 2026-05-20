import { NextRequest, NextResponse } from "next/server";
import { listMemory, upsertMemory } from "@/lib/db/queries";
import { currentUser } from "@/lib/auth/identity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ memory: listMemory(user.id) });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { key, value } = await req.json();
  if (!key || !value) return NextResponse.json({ error: "key and value required" }, { status: 400 });
  return NextResponse.json({ item: upsertMemory(key, value, undefined, user.id) });
}
