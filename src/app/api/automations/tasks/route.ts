import { NextRequest, NextResponse } from "next/server";
import { listTasks, createTask } from "@/lib/db/automations";
import { nlToCron, describeCron } from "@/lib/cron";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    tasks: listTasks().map((t) => ({ ...t, schedule: describeCron(t.cron) })),
  });
}

export async function POST(req: NextRequest) {
  const { name, schedule, prompt, delivery_channel } = await req.json();
  if (!name || !prompt || !schedule) {
    return NextResponse.json({ error: "name, schedule and prompt required" }, { status: 400 });
  }
  const cron = /^[\d*/, -]+( [\d*/, -]+){4}$/.test(schedule) ? schedule : nlToCron(schedule);
  const task = createTask({ name, cron, prompt, delivery_channel });
  return NextResponse.json({ task: { ...task, schedule: describeCron(task.cron) } });
}
