import { NextRequest, NextResponse } from "next/server";
import { exportPresentation, getPresentation } from "@/lib/db/presentations";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const { id } = await paramsPromise;
  const body = await req.json().catch(() => ({}));
  const format = (body.format || "pptx") as "pptx" | "pdf" | "html";
  const result = await exportPresentation(id, format);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, path: result.path, presentation: getPresentation(id) });
}
