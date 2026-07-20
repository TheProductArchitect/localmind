import { NextRequest, NextResponse } from "next/server";
import { listSiteGrants, setSiteGrant, removeSiteGrant } from "@/lib/agent/web-guard";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ grants: listSiteGrants() });
}

export async function POST(req: NextRequest) {
  const { domain, policy, note } = await req.json();
  if (typeof domain !== "string" || !["allow", "never"].includes(policy)) {
    return NextResponse.json({ error: "domain and policy ('allow'|'never') required" }, { status: 400 });
  }
  try {
    setSiteGrant(domain, policy, typeof note === "string" ? note : undefined);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "invalid domain" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, grants: listSiteGrants() });
}

export async function DELETE(req: NextRequest) {
  const { domain } = await req.json();
  if (typeof domain !== "string") return NextResponse.json({ error: "domain required" }, { status: 400 });
  removeSiteGrant(domain);
  return NextResponse.json({ ok: true, grants: listSiteGrants() });
}
