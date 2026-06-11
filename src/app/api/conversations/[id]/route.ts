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

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { conv } = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv, messages: getMessages(params.id) });
}

/**
 * A conversation is "relayed" if it has either a `relayed_from:<peer>:…` tag
 * (we are the executor for a peer's session) or a `relayed_to:<peer>` tag (we
 * are driving a peer). Relayed conversations are part of a bilateral, signed
 * audit chain — deleting one side breaks the chain and removes evidence the
 * other side still holds. So we refuse delete on both sides; title/starred
 * edits are still fine.
 */
function isRelayedConversation(conv: { tags: string }): boolean {
  try {
    const tags = JSON.parse(conv.tags || "[]") as string[];
    return tags.some((t) => t.startsWith("relayed_from:") || t.startsWith("relayed_to:"));
  } catch {
    return false;
  }
}

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { conv } = authorised(req, params.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const wantsDelete = "deleted" in body && body.deleted === true || ("deleted_at" in body && body.deleted_at);
  if (wantsDelete && isRelayedConversation(conv)) {
    return NextResponse.json(
      {
        error:
          "Peer-relayed conversations cannot be deleted. They're part of a bilateral, signed audit chain — removing one side would break the other peer's record. You can rename it, but the history stays.",
      },
      { status: 409 }
    );
  }
  const patch: any = {};
  for (const k of ["title", "starred", "tags", "deleted_at"]) {
    if (k in body) patch[k] = body[k];
  }
  if ("deleted" in body) patch.deleted_at = body.deleted ? Date.now() : null;
  updateConversation(params.id, patch);
  return NextResponse.json({ ok: true });
}
