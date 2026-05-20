import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUser, updateUser } from "@/lib/db/users";
import { issueSession, authCookies } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; until: number }>();

export async function POST(req: NextRequest) {
  const { userId, pin } = await req.json();
  const user = userId ? getUser(userId) : null;
  if (!user || !user.active) {
    return NextResponse.json({ error: "Unknown account" }, { status: 401 });
  }

  const lock = attempts.get(user.id);
  if (lock && lock.until > Date.now()) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  if (!user.pin_hash || !(await bcrypt.compare(String(pin || ""), user.pin_hash))) {
    const cur = attempts.get(user.id) || { count: 0, until: 0 };
    cur.count++;
    if (cur.count >= 3) cur.until = Date.now() + 5 * 60 * 1000;
    attempts.set(user.id, cur);
    logger.warn("failed login", { userId: user.id });
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  attempts.delete(user.id);
  updateUser(user.id, { last_login_at: Date.now() });

  const device = req.headers.get("user-agent") || "unknown";
  const ip = req.headers.get("x-forwarded-for") || "local";
  const { access, refresh, session } = issueSession(user, device, ip, "pin");

  const res = NextResponse.json({ user: { id: user.id, display_name: user.display_name, role: user.role } });
  for (const c of authCookies(access, refresh, session.id)) res.headers.append("Set-Cookie", c);
  return res;
}
