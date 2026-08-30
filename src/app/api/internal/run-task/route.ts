import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { getTask, recordTaskRun } from "@/lib/db/automations";
import { runAgentCollect } from "@/lib/agent/engine";
import { createConversation } from "@/lib/db/queries";
import { deliver } from "@/lib/workflow/deliver";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { taskId } = await req.json();
  const task = getTask(taskId);
  if (!task || !task.enabled) return NextResponse.json({ skipped: true });

  try {
    const convId = createConversation(
      undefined,
      task.creator_user_id || undefined
    ).id;
    const output = await runAgentCollect(convId, task.prompt, {
      systemPrefix: `You are running a scheduled task named "${task.name}". Produce the requested output directly.`,
      processDisplayName: `Scheduled: ${task.name}`,
      processMetadata: { kind: "scheduled_task", task_id: task.id },
    });
    recordTaskRun(task.id, output);
    if (task.delivery_channel !== "log") {
      await deliver(task.delivery_channel, `[${task.name}]\n\n${output}`);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
