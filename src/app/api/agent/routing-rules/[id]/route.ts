import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateRule, deleteRule, getRule } from "@/lib/db/routing-rules";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    condition_type: z.enum(["task_type", "message_length", "tool_required", "persona_active", "time_of_day"]).optional(),
    condition_value: z.string().nullable().optional(),
    target_agent_name: z.string().min(1).max(80).optional(),
    sort_order: z.number().int().optional(),
    enabled: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  if (!getRule(params.id)) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  const patch = parsed.data as Record<string, unknown>;
  if ("enabled" in patch) patch.enabled = patch.enabled ? 1 : 0;
  updateRule(params.id, patch);
  return NextResponse.json({ rule: getRule(params.id) });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const ok = deleteRule(params.id);
  return NextResponse.json({ ok });
}
