import { NextRequest, NextResponse } from "next/server";
import { uninstallPlugin, updatePlugin } from "@/lib/plugins/install";
import { getRegistry, findRegistryPlugin } from "@/lib/plugins/registry";
import { getInstalled } from "@/lib/db/plugins";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const plugin = getInstalled(params.id);
  if (!plugin) return NextResponse.json({ error: "Plugin not found." }, { status: 404 });
  return NextResponse.json({ plugin });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = uninstallPlugin(params.id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// POST is the "update to latest" action — re-fetches the registry entry and
// reinstalls in place.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const plugin = getInstalled(params.id);
  if (!plugin) return NextResponse.json({ error: "Plugin not found." }, { status: 404 });
  let registryId: string | null = null;
  try {
    const cfg = JSON.parse(plugin.config_json) as { registry_id?: string };
    registryId = cfg.registry_id ?? null;
  } catch { /* fall through */ }
  if (!registryId) {
    return NextResponse.json({ error: "Plugin has no registry id — cannot auto-update." }, { status: 400 });
  }
  const reg = await getRegistry({ refresh: true });
  const entry = findRegistryPlugin(reg, registryId);
  if (!entry) return NextResponse.json({ error: "Plugin no longer in registry." }, { status: 404 });
  const r = await updatePlugin(params.id, entry);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
