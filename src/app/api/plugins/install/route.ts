import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRegistry, findRegistryPlugin } from "@/lib/plugins/registry";
import { installPlugin } from "@/lib/plugins/install";

export const runtime = "nodejs";

const Body = z.object({ registry_id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const reg = await getRegistry();
  const entry = findRegistryPlugin(reg, parsed.data.registry_id);
  if (!entry) return NextResponse.json({ error: "Plugin not found in registry." }, { status: 404 });

  const result = await installPlugin(entry);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true, receipt: result.receipt });
}
