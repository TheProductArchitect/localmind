import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGlobalContextSettings, updateGlobalContextSettings } from "@/lib/db/context-settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ settings: getGlobalContextSettings() });
}

const PatchBody = z
  .object({
    compression_threshold_pct: z.number().int().min(50).max(95).optional(),
    compression_target_pct: z.number().int().min(20).max(80).optional(),
    compression_strategy: z.enum(["summarise", "truncate", "sliding_window"]).optional(),
    summarisation_model: z.string().max(120).nullable().optional(),
    tool_result_max_chars: z.number().int().min(500).max(20000).optional(),
    per_conversation_override_enabled: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid context settings payload." }, { status: 400 });
  }
  const patch = parsed.data as Record<string, unknown>;
  if ("per_conversation_override_enabled" in patch) {
    patch.per_conversation_override_enabled = patch.per_conversation_override_enabled ? 1 : 0;
  }
  return NextResponse.json({ settings: updateGlobalContextSettings(patch) });
}
