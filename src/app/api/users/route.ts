import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { listUsers, createUser } from "@/lib/db/users";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!requireRole(req, "owner")) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  return NextResponse.json({
    users: listUsers().map(({ pin_hash, ...u }) => ({ ...u, pin_set: !!pin_hash })),
  });
}

export async function POST(req: NextRequest) {
  if (!requireRole(req, "owner")) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { display_name, role, pin, permission_profile_id, allowed_channels } = await req.json();
  if (!display_name || !role) {
    return NextResponse.json({ error: "display_name and role required" }, { status: 400 });
  }
  const user = createUser({
    display_name,
    role,
    pin_hash: pin ? await bcrypt.hash(String(pin), 12) : null,
    permission_profile_id: permission_profile_id || "normal",
    allowed_channels: allowed_channels || [],
  });
  return NextResponse.json({ user: { id: user.id, display_name: user.display_name } });
}
