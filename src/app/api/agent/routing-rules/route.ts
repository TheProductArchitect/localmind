import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listRules, createRule, evaluateRules, reorderRules } from "@/lib/db/routing-rules";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("evaluate") === "1") {
    const ctx = {
      task_type: sp.get("task_type") || undefined,
      message_length: sp.get("message_length") ? Number(sp.get("message_length")) : undefined,
      required_tools: sp.get("required_tools")?.split(",").filter(Boolean) || undefined,
      active_persona: sp.get("active_persona") || undefined,
      manual_override_agent: sp.get("manual_override_agent") || undefined,
    };
    return NextResponse.json({ match: evaluateRules(ctx), context: ctx });
  }
  return NextResponse.json({ rules: listRules() });
}

const CreateBody = z.object({
  condition_type: z.enum(["task_type", "message_length", "tool_required", "persona_active", "time_of_day"]),
  condition_value: z.string().nullable().optional(),
  target_agent_name: z.string().min(1).max(80),
  sort_order: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

const ReorderBody = z.object({ order: z.array(z.string()) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body && Array.isArray(body.order)) {
    const parsed = ReorderBody.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid order payload." }, { status: 400 });
    reorderRules(parsed.data.order);
    return NextResponse.json({ ok: true });
  }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid rule payload." }, { status: 400 });
  return NextResponse.json({ rule: createRule(parsed.data) });
}
