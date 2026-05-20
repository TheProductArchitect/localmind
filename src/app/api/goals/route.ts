import { NextRequest, NextResponse } from "next/server";
import { listGoals, createGoal } from "@/lib/db/goals";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    goals: listGoals().map((g) => ({ ...g, milestones: JSON.parse(g.milestones), progress_notes: JSON.parse(g.progress_notes) })),
  });
}

export async function POST(req: NextRequest) {
  const { description, target_date, milestones } = await req.json();
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  return NextResponse.json({ goal: createGoal({ description, target_date, milestones }) });
}
