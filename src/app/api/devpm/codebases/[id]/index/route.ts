import { NextRequest, NextResponse } from "next/server";
import { indexCodebase } from "@/lib/devpm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = indexCodebase(params.id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Indexing failed" }, { status: 500 });
  }
}
