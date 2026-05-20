import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { countUsers, listUsers } from "@/lib/db/users";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (auth) {
    return NextResponse.json({
      user: {
        id: auth.user.id,
        display_name: auth.user.display_name,
        role: auth.user.role,
      },
    });
  }
  // Not authenticated — return the account list so the login screen can render.
  return NextResponse.json({
    user: null,
    hasUsers: countUsers() > 0,
    accounts: listUsers().map((u) => ({ id: u.id, display_name: u.display_name, role: u.role, avatar: u.avatar })),
  });
}
