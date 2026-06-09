import { NextRequest, NextResponse } from "next/server";
import { setMcpToolTier } from "@/lib/db/mcp";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const { tier } = await req.json();
  if (!["allow", "ask", "pin"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  setMcpToolTier(params.id, tier);
  return NextResponse.json({ ok: true });
}
