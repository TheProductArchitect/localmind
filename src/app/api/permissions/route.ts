import { NextRequest, NextResponse } from "next/server";
import { getSettings, listProfiles, updateProfileTiers, createProfile } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const s = getSettings();
  return NextResponse.json({ profiles: listProfiles(), active: s.active_profile_id });
}

export async function PATCH(req: NextRequest) {
  const { id, tiers } = await req.json();
  if (!id || !tiers) return NextResponse.json({ error: "id and tiers required" }, { status: 400 });
  updateProfileTiers(id, tiers);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { name, tiers } = await req.json();
  if (!name || !tiers) return NextResponse.json({ error: "name and tiers required" }, { status: 400 });
  const profile = createProfile(name, tiers);
  return NextResponse.json({ profile });
}
