import { NextRequest, NextResponse } from "next/server";
import { runWorkflow } from "@/lib/workflow/executor";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  try {
    const result = await runWorkflow(params.id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Workflow run failed" }, { status: 500 });
  }
}
