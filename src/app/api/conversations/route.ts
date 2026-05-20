import { NextRequest, NextResponse } from "next/server";
import { createConversation, getSettings, listConversations } from "@/lib/db/queries";
import { currentUser } from "@/lib/auth/identity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ conversations: listConversations(user.id) });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = getSettings();
  const conv = createConversation(s.active_profile_id, user.id);
  return NextResponse.json({ conversation: conv });
}
