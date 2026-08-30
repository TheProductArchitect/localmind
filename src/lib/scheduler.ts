/**
 * Ambient cron tick — fires once a minute while LocalMind is running.
 *
 * Why a built-in loop instead of OS cron
 * --------------------------------------
 * LocalMind needs to be "always on, ambiently sleeping" — the user installs
 * it once and walks away; cron jobs should land on time without anyone
 * babysitting a terminal. An in-process tick that runs every minute is the
 * smallest correct version: cheap (one setTimeout, no busy loop), idle when
 * there's nothing to do (the loop just rolls over), and re-entrant safe
 * (one in-flight tick at a time, plus a per-task lock so a slow task can't
 * be re-fired by the next minute's tick).
 *
 * Pairing with the OS
 * --------------------
 * For LocalMind to actually fire when the user isn't poking it, the Node
 * process itself has to stay alive. That's what the "Run LocalMind always"
 * launchd / systemd unit is for (see lib/always-on.ts). The two pieces
 * together give the user "set a cron task → it runs, full stop."
 */

import { logger } from "./logger";
import { cronMatches } from "./cron";
import { listTasks, recordTaskRun, listDueOneShots, setTaskEnabled } from "./db/automations";
import { runAgentCollect } from "./agent/engine";
import { createConversation } from "./db/queries";

const TICK_MS = 60_000;

// Per-task lock: while a scheduled task is still running, don't re-fire it
// on the next minute even if the cron matches again. The lock is in-memory
// only; on restart, any task that was running gets the next-matching minute
// to start again, which is the desired idempotency.
const inFlight = new Set<string>();

// One tick at a time across the whole process. A long DB read shouldn't be
// interleaved with another tick's read.
let tickRunning = false;
let timer: NodeJS.Timeout | null = null;

async function runTaskOnce(task: import("./db/automations").ScheduledTask): Promise<boolean> {
  if (inFlight.has(task.id)) return false;
  inFlight.add(task.id);
  const t0 = Date.now();
  try {
    // Preserve the task creator on the generated conversation so scheduled
    // work receives that user's memory/profile context and remains isolated
    // from other users on a shared LocalMind instance.
    const convId = createConversation(undefined, task.creator_user_id || undefined).id;
    const output = await runAgentCollect(convId, task.prompt, {
      systemPrefix: `You are running a scheduled task named "${task.name}". Produce the requested output directly.`,
      processDisplayName: `Scheduled: ${task.name}`,
      processMetadata: { kind: "scheduled_task", task_id: task.id },
    });
    recordTaskRun(task.id, output);
    if (task.delivery_channel && task.delivery_channel !== "log") {
      // Dynamic so the cron loop doesn't pull in mail/notify code on cold start.
      const { deliver } = await import("./workflow/deliver");
      await deliver(task.delivery_channel, `[${task.name}]\n\n${output}`);
    }
    logger.info("scheduled task complete", {
      task: task.name, duration_ms: Date.now() - t0,
    });
    return true;
  } catch (e) {
    logger.error("scheduled task failed", {
      task: task.name, error: (e as Error).message,
    });
    return false;
  } finally {
    inFlight.delete(task.id);
  }
}

async function tickOnce(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const now = new Date();
    // One-shot reminders due now — fire once, then disable.
    const oneShots = listDueOneShots(now.getTime());
    for (const t of oneShots) {
      const delivered = await runTaskOnce(t);
      // A failed one-shot must remain due so the next tick retries it. Disabling
      // here would silently lose exactly the reminders users rely on most.
      if (delivered) setTaskEnabled(t.id, false);
    }
    // Recurring cron tasks (run_at NULL).
    const tasks = listTasks().filter((t) => t.enabled && t.run_at == null);
    const minuteStart = now.getTime() - now.getSeconds() * 1000 - now.getMilliseconds();
    const due = tasks.filter((t) => {
      // The process may restart or hot-reload inside the same matching minute.
      // Persisted last_run_at prevents a second send/action after that restart.
      if (t.last_run_at != null && t.last_run_at >= minuteStart) return false;
      try { return cronMatches(t.cron, now); } catch { return false; }
    });
    if (due.length === 0) return;
    // Fire all due tasks concurrently. The per-task lock + the engine's
    // resource governor keep this safe under any reasonable schedule.
    await Promise.all(due.map(runTaskOnce));
  } finally {
    tickRunning = false;
  }
}

/**
 * Start the scheduler. Idempotent — second call is a no-op when the loop
 * is already running (which happens under Next dev's instrumentation
 * re-fire). The loop uses setTimeout (not setInterval) so a slow tick
 * never queues up overlapping tick callbacks.
 */
export function startScheduler(): void {
  if (timer) return;
  const schedule = (delayMs: number) => {
    timer = setTimeout(async () => {
      try { await tickOnce(); } catch { /* never throw out of the loop */ }
      schedule(TICK_MS);
    }, delayMs);
    // Don't keep the event loop alive purely for this tick — if the rest of
    // the process is shutting down, the scheduler should shut down with it.
    timer.unref?.();
  };
  // First tick at the next round minute boundary, so a task like "* */15 * * *"
  // doesn't fire off-schedule from a server that booted at :47.
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  schedule(Math.max(1000, msToNextMinute));
  logger.info("scheduler started", { tick_ms: TICK_MS, first_tick_in_ms: msToNextMinute });
}

export function stopScheduler(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Exposed for tests. */
export const __scheduler_internals = { tickOnce, runTaskOnce };
