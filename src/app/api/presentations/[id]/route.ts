import { NextRequest, NextResponse } from "next/server";
import {
  getPresentation,
  readDeck,
  updatePresentationSlides,
  exportPresentation,
} from "@/lib/db/presentations";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const { id } = await paramsPromise;
  const row = getPresentation(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ presentation: row, deck: readDeck(id) });
}

export async function PATCH(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const { id } = await paramsPromise;
  const body = await req.json();
  if (!Array.isArray(body.slides)) {
    return NextResponse.json({ error: "slides required" }, { status: 400 });
  }
  const row = updatePresentationSlides(id, body.slides, body.title);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ presentation: row, deck: readDeck(id) });
}

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
