import { NextResponse } from "next/server";
import { listInstalled, setEnabled } from "@/lib/db/plugins";
import { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ installed: listInstalled() });
}

const PatchBody = z.object({
  plugin_id: z.string().min(1),
  enabled: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  setEnabled(parsed.data.plugin_id, parsed.data.enabled);
  return NextResponse.json({ ok: true });
}
