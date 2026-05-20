import { NextRequest, NextResponse } from "next/server";
import { getConversation, getMessages, updateConversation } from "@/lib/db/queries";
import { currentUser, isOwner } from "@/lib/auth/identity";

export const runtime = "nodejs";

// Returns the conversation only if it belongs to the requester (404 otherwise,
// so existence is not leaked across users).
function authorised(req: NextRequest, id: string) {
  const user = currentUser(req);
  const conv = getConversation(id);
  if (!user || !conv) return { conv: null, user };
  if (conv.owner_user_id && conv.owner_user_id !== user.id && !isOwner(req)) {
    return { conv: null, user };
  }
  return { conv, user };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { conv } = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv, messages: getMessages(params.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { conv } = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const patch: any = {};
  for (const k of ["title", "starred", "tags", "deleted_at"]) {
    if (k in body) patch[k] = body[k];
  }
  if ("deleted" in body) patch.deleted_at = body.deleted ? Date.now() : null;
  updateConversation(params.id, patch);
  return NextResponse.json({ ok: true });
}
