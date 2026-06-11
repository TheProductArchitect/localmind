import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setOverride, deleteOverride, getOverride } from "@/lib/db/model-context-overrides";

export const runtime = "nodejs";

const PutBody = z.object({
  context_window_tokens: z.number().int().min(512).max(2_000_000),
});

export async function PUT(req: NextRequest, { params: paramsPromise }: { params: Promise<{ modelName: string }> }) {
  const params = await paramsPromise;
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid context_window_tokens." }, { status: 400 });
  }
  const name = decodeURIComponent(params.modelName);
  return NextResponse.json({ override: setOverride(name, parsed.data.context_window_tokens) });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ modelName: string }> }) {
  const params = await paramsPromise;
  const name = decodeURIComponent(params.modelName);
  deleteOverride(name);
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ modelName: string }> }) {
  const params = await paramsPromise;
  const name = decodeURIComponent(params.modelName);
  return NextResponse.json({ override: getOverride(name) });
}
