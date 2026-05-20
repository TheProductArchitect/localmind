import { NextRequest, NextResponse } from "next/server";
import { runAgentCollect } from "@/lib/agent/engine";
import { createConversation } from "@/lib/db/queries";
import { listGoals } from "@/lib/db/goals";
import { listTasks } from "@/lib/db/automations";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { kind } = await req.json().catch(() => ({ kind: "briefing" }));
  const convId = createConversation().id;
  const goals = listGoals().filter((g) => g.status === "active");
  const tasks = listTasks().filter((t) => t.enabled);

  const context = [
    goals.length ? `Active goals: ${goals.map((g) => `${g.description} (${g.progress}%)`).join("; ")}` : "",
    tasks.length ? `Scheduled tasks: ${tasks.map((t) => t.name).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt =
    kind === "weekly"
      ? `Generate a weekly review. Ask reflective questions (what went well, what was frustrating, what to change, priorities for next week) and summarise the week.\n${context}`
      : `Generate a morning briefing for today: calendar events to prepare for, top open tasks, anything notable, and a one-line status for each active goal.\n${context}`;

  const output = await runAgentCollect(convId, prompt, {
    systemPrefix: "You are LocalMind producing a proactive briefing. Be concise and actionable.",
  });
  return NextResponse.json({ briefing: output });
}
