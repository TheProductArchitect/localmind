import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { countUsers, createUser } from "@/lib/db/users";

export const runtime = "nodejs";

// Creates the owner account. Used once during onboarding.
export async function POST(req: NextRequest) {
  if (countUsers() > 0) {
    return NextResponse.json({ error: "Owner already exists" }, { status: 409 });
  }
  const { display_name, pin } = await req.json();
  if (!pin || String(pin).length < 4) {
    return NextResponse.json({ error: "A PIN of at least 4 digits is required" }, { status: 400 });
  }
  const user = createUser({
    display_name: display_name || "Owner",
    role: "owner",
    pin_hash: await bcrypt.hash(String(pin), 12),
    permission_profile_id: "normal",
  });
  return NextResponse.json({ user: { id: user.id, display_name: user.display_name } });
}
