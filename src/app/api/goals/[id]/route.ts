import { NextRequest, NextResponse } from "next/server";
import { updateGoal, deleteGoal } from "@/lib/db/goals";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  updateGoal(params.id, await req.json());
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  deleteGoal(params.id);
  return NextResponse.json({ ok: true });
}
