import { NextRequest, NextResponse } from "next/server";
import { listSessions, getUser } from "@/lib/db/users";
import { getAuth } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sessions = auth.user.role === "owner" ? listSessions() : listSessions(auth.user.id);
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      ...s,
      refresh_token_hash: undefined,
      user_name: getUser(s.user_id)?.display_name || "unknown",
      current: s.id === auth.sessionId,
    })),
  });
}
