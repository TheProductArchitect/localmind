import { NextRequest, NextResponse } from "next/server";
import { listRoles, createRole } from "@/lib/db/users";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    roles: listRoles().map((r) => ({ ...r, allowed_tools: JSON.parse(r.allowed_tools === "*" ? '"*"' : r.allowed_tools) })),
  });
}

export async function POST(req: NextRequest) {
  if (!requireRole(req, "owner")) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { name, allowed_tools } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  return NextResponse.json({ role: createRole(name, allowed_tools || []) });
}
