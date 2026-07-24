import { NextRequest, NextResponse } from "next/server";
import {
  listPresentations,
  createPresentation,
  getPresentation,
  readDeck,
} from "@/lib/db/presentations";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ presentations: listPresentations() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = String(body.title || "Untitled presentation").trim();
  const row = createPresentation({
    title,
    outline: body.outline ? String(body.outline) : undefined,
    slides: Array.isArray(body.slides) ? body.slides : undefined,
  });
  return NextResponse.json({ presentation: row, deck: readDeck(row.id) });
}
