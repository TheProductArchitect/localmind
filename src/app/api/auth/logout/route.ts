import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/db/users";
import { clearCookies } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sid = req.cookies.get("lm_session")?.value;
  if (sid) revokeSession(sid);
  const res = NextResponse.json({ ok: true });
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}
