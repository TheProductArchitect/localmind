import { NextRequest, NextResponse } from "next/server";
import { getSession, revokeSession } from "@/lib/db/users";
import { getAuth } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const session = getSession(params.id);
  if (!session) return NextResponse.json({ ok: true });
  if (auth.user.role !== "owner" && session.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Cannot revoke another user's session" }, { status: 403 });
  }
  revokeSession(params.id);
  return NextResponse.json({ ok: true });
}
