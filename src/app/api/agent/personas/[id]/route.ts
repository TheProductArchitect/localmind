import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPersona, updatePersona, deletePersona } from "@/lib/db/personas";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullish(),
    model_name: z.string().max(120).nullish(),
    enabled_tools: z.array(z.string()).optional(),
    permission_profile_id: z.string().max(80).nullish(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const persona = getPersona(params.id);
  if (!persona) return NextResponse.json({ error: "Persona not found." }, { status: 404 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.enabled_tools) patch.enabled_tools = JSON.stringify(parsed.data.enabled_tools);
  updatePersona(params.id, patch);
  return NextResponse.json({ persona: getPersona(params.id) });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const result = deletePersona(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason || "Could not delete persona." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
