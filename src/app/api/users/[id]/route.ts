import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { updateUser, deactivateUser } from "@/lib/db/users";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  if (!requireRole(req, "owner")) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const body = await req.json();
  const patch: any = {};
  for (const k of ["display_name", "role", "permission_profile_id", "allowed_channels", "avatar"]) {
    if (k in body) patch[k] = body[k];
  }
  if (body.pin) patch.pin_hash = await bcrypt.hash(String(body.pin), 12);
  updateUser(params.id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  if (!requireRole(req, "owner")) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  deactivateUser(params.id);
  return NextResponse.json({ ok: true });
}
