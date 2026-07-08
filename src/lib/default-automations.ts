import { listTasks, createTask } from "./db/automations";

const MORNING_BRIEFING_NAME = "Morning Briefing";

/**
 * Idempotently seeds built-in scheduled tasks. Safe to call on every boot.
 */
export function ensureDefaultAutomations(): void {
  const tasks = listTasks();
  if (!tasks.some((t) => t.name === MORNING_BRIEFING_NAME)) {
    createTask({
      name: MORNING_BRIEFING_NAME,
      cron: "0 8 * * *",
      prompt:
        "Generate a morning briefing for today: calendar events to prepare for, top open tasks, anything notable, and a one-line status for each active goal. Be concise and actionable.",
      delivery_channel: "browser",
    });
  }
}
