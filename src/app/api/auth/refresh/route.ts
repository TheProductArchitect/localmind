import { NextRequest, NextResponse } from "next/server";
import { findSessionByRefresh, getUser, rotateRefresh } from "@/lib/db/users";
import { hashToken, randomToken, signJwt } from "@/lib/auth/jwt";
import { ACCESS_TTL, REFRESH_TTL_MS, authCookies } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const refresh = req.cookies.get("lm_refresh")?.value;
  if (!refresh) return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  const session = findSessionByRefresh(hashToken(refresh));
  if (!session || session.expires_at < Date.now()) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }
  const user = getUser(session.user_id);
  if (!user || !user.active) return NextResponse.json({ error: "Account inactive" }, { status: 401 });

  const newRefresh = randomToken();
  const ttlMs = REFRESH_TTL_MS[user.role] ?? REFRESH_TTL_MS.member;
  rotateRefresh(session.id, hashToken(newRefresh), ttlMs);
  const access = signJwt({ userId: user.id, role: user.role }, ACCESS_TTL);

  const res = NextResponse.json({ ok: true });
  for (const c of authCookies(access, newRefresh, session.id)) res.headers.append("Set-Cookie", c);
  return res;
}
