import { NextRequest, NextResponse } from "next/server";
import { resumeWorkflow } from "@/lib/workflow/executor";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await resumeWorkflow(id, true);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "approve failed" }, { status: 400 });
  }
}
