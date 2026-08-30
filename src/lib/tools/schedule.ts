import { nlToCron, describeCron, cronMatches } from "../cron";
import {
  listTasks,
  getTask,
  createTask,
  setTaskEnabled,
  deleteTask,
  updateTask,
  type ScheduledTask,
} from "../db/automations";
import { listChannels } from "../db/channels";
import { getConversation } from "../db/queries";
import type { Tool } from "./types";

// A 5-field cron ("min hour dom mon dow"). If the schedule already looks like
// one we pass it through; otherwise we run it through NL parsing.
function isCronExpr(s: string): boolean {
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return cronMatches(parts.join(" "), new Date()) || /^[\d*/,\-\s]+$/.test(s.trim());
}

// Parse a schedule string into either a one-shot run_at (epoch ms) or a
// recurring cron. Relative ("in 4 minutes") and near-term absolute ("tomorrow
// at 9") phrasings are one-shot; everything else falls back to recurring cron.
export function parseWhen(schedule: string): { runAt?: number; cron?: string } {
  const t = String(schedule || "").toLowerCase().trim();
  if (!t) return { cron: nlToCron(t) };
  if (isCronExpr(t)) return { cron: t };

  // Relative one-shot: "in 4 minutes", "in 2 hours", "in 1 day".
  const rel = t.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|day|week)s?\b/);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2];
    const mult =
      u.startsWith("hour") || u.startsWith("hr")
        ? 3_600_000
        : u.startsWith("day")
          ? 86_400_000
          : u.startsWith("week")
            ? 7 * 86_400_000
            : 60_000;
    return { runAt: Date.now() + n * mult };
  }

  // Near-term absolute one-shot: "tomorrow at 9", "tonight", "today at 5pm".
  if (/\btomorrow\b|\btonight\b|\btoday\b/.test(t)) {
    const d = new Date();
    const clock = parseClock(t, /tonight/.test(t) ? 20 : 9);
    if (/tomorrow/.test(t)) d.setDate(d.getDate() + 1);
    d.setHours(clock.hour, clock.minute, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return { runAt: d.getTime() };
  }

  // Explicit recurrence stays cron. A named weekday without "every" means the
  // next occurrence once — "remind me Friday" should not repeat forever.
  if (/\b(every|daily|weekly|weekdays?|weekends?|hourly)\b/.test(t)) {
    return { cron: nlToCron(t) };
  }

  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const weekday = Object.keys(weekdays).find((name) =>
    new RegExp(`\\b(?:this\\s+|next\\s+|on\\s+)?${name}\\b`).test(t)
  );
  if (weekday) {
    const now = new Date();
    const d = new Date(now);
    const clock = parseClock(t, 9);
    d.setHours(clock.hour, clock.minute, 0, 0);
    let days = (weekdays[weekday] - now.getDay() + 7) % 7;
    if (days === 0 && d.getTime() <= now.getTime()) days = 7;
    if (/\bnext\s+/.test(t) && days === 0) days = 7;
    d.setDate(d.getDate() + days);
    return { runAt: d.getTime() };
  }

  // A bare clock time is a one-shot at the next occurrence.
  if (/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/.test(t)) {
    const now = new Date();
    const d = new Date(now);
    const clock = parseClock(t, 9);
    d.setHours(clock.hour, clock.minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { runAt: d.getTime() };
  }

  // Recurring.
  return { cron: nlToCron(t) };
}

function parseClock(text: string, defaultHour: number): { hour: number; minute: number } {
  const match =
    text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ||
    text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match) return { hour: defaultHour, minute: 0 };
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

/** Human description of when a task runs (one-shot or recurring). */
export function describeWhen(task: Pick<ScheduledTask, "cron" | "run_at">): string {
  if (task.run_at) return `once at ${new Date(task.run_at).toLocaleString()}`;
  return describeCron(task.cron);
}

// Delivery channels a task may use. "browser" is always available; the rest
// must be enabled in Settings → Channels.
function allowedDeliveryChannels(): string[] {
  const implemented = new Set(["telegram", "email"]);
  const enabled = listChannels()
    .filter((c) => c.enabled && implemented.has(c.type))
    .map((c) => c.type);
  return ["browser", ...enabled];
}

// Small local models often mangle the operation ("set_enabled" when they mean
// "create") or omit it. Infer the real intent from the arguments so a near-miss
// still works rather than failing silently.
function normalizeOperation(input: Record<string, any>): string {
  let op = String(input.operation || "").toLowerCase().trim();
  if (/^(create|add|new|schedule|remind|reminder|make|set)$/.test(op)) op = "create";
  else if (/^(list|get|show|read)$/.test(op)) op = "list";
  else if (/^(remove|cancel|del|delete)$/.test(op)) op = "delete";
  const valid = ["create", "list", "update", "set_enabled", "delete"];
  if (!valid.includes(op)) op = input.schedule || input.prompt ? "create" : "list";
  // A set_enabled/update with no id but a schedule+prompt is really a create.
  if ((op === "set_enabled" || op === "update") && !input.id && (input.schedule || input.prompt)) op = "create";
  return op;
}

function deriveName(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");
  return words ? `Reminder: ${words}` : "Reminder";
}

export const scheduleTool: Tool = {
  actionType: "schedule_write",
  classify: (i) => {
    const op = normalizeOperation(i);
    if (op === "list") return "read_schedule";
    if (op === "delete") return "delete_automation";
    return "schedule_write";
  },
  preview: (i) => {
    const op = normalizeOperation(i);
    if (op === "create" || op === "update") {
      let when = "";
      if (i.schedule) {
        const w = parseWhen(String(i.schedule));
        when = w.runAt ? ` — ${describeWhen({ cron: "", run_at: w.runAt })}` : ` — runs ${describeCron(w.cron!)}`;
      }
      const via = i.delivery_channel ? `, delivers via ${i.delivery_channel}` : "";
      return `${op === "create" ? "Create" : "Update"} reminder "${i.name ?? deriveName(String(i.prompt || ""))}"${when}${via}`;
    }
    if (op === "set_enabled") return `${i.enabled === false || i.enabled === "false" ? "Disable" : "Enable"} task ${i.id}`;
    if (op === "delete") return `Delete task ${i.id}`;
    return "List scheduled tasks";
  },
  definition: {
    name: "schedule_task",
    description:
      "Schedule work for the user: one-off reminders (\"remind me to drink water in 4 minutes\", \"tomorrow at 9\") AND recurring tasks (\"every weekday at 7:30\"). Prefer this over telling the user to set a reminder manually. Operations: create, list, update, set_enabled, delete. For `schedule`, pass natural language or a 5-field cron; relative times become one-off reminders. Creating a task always asks the user to confirm the resolved time first.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "list", "update", "set_enabled", "delete"] },
        id: { type: "string", description: "Task id (update/set_enabled/delete)" },
        name: { type: "string", description: "Short task name (optional; derived from the prompt if omitted)" },
        schedule: {
          type: "string",
          description: "When to run: \"in 4 minutes\", \"tomorrow at 9\", \"every weekday at 7:30\", or a 5-field cron",
        },
        prompt: { type: "string", description: "What to do each run (e.g. \"Remind me to drink water\")" },
        delivery_channel: {
          type: "string",
          description: "Where to deliver: browser (default), telegram, email, … (falls back to browser if not connected)",
        },
        enabled: { type: "boolean", description: "For set_enabled" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const op = normalizeOperation(input);
    try {
      if (op === "list") {
        const tasks = listTasks();
        if (tasks.length === 0) return { ok: true, output: "(no scheduled tasks)", summary: "no tasks" };
        const lines = tasks.map(
          (t) =>
            `- [${t.id}] ${t.name} — ${describeWhen(t)} via ${t.delivery_channel}` +
            `${t.enabled ? "" : " (disabled)"}${t.last_run_at ? ` · last run ${new Date(t.last_run_at).toISOString()}` : ""}`
        );
        return { ok: true, output: lines.join("\n"), summary: `${tasks.length} task(s)` };
      }

      if (op === "create") {
        const prompt = String(input.prompt || "").trim();
        const schedule = String(input.schedule || "").trim();
        if (!prompt || !schedule) return { ok: false, output: "schedule and prompt are required" };
        const name = String(input.name || "").trim() || deriveName(prompt);
        const when = parseWhen(schedule);

        // Fall back to in-app delivery rather than blocking if the requested
        // channel isn't connected — the reminder still happens.
        let channel = String(input.delivery_channel || "browser");
        const allowed = allowedDeliveryChannels();
        let channelNote = "";
        if (!allowed.includes(channel)) {
          channelNote = ` (${channel} isn't available for scheduled delivery, so this surfaces in-app; use browser, Telegram, or email)`;
          channel = "browser";
        }

        const owner = getConvOwner(ctx.conversationId);
        const task = createTask({
          name,
          cron: when.cron ?? "@once",
          prompt,
          delivery_channel: channel,
          creator: owner,
          run_at: when.runAt ?? null,
        });
        return {
          ok: true,
          output: `Created "${task.name}" [${task.id}] — ${describeWhen(task)}, delivers via ${channel}.${channelNote}`,
          summary: `scheduled "${task.name}" ${describeWhen(task)}`,
        };
      }

      if (op === "update") {
        const id = String(input.id || "");
        if (!getTask(id)) return { ok: false, output: `No task with id ${id}` };
        const patch: {
          name?: string;
          cron?: string;
          prompt?: string;
          delivery_channel?: string;
          run_at?: number | null;
        } = {};
        if (input.name != null) patch.name = String(input.name);
        if (input.prompt != null) patch.prompt = String(input.prompt);
        if (input.schedule != null) {
          const w = parseWhen(String(input.schedule));
          patch.cron = w.cron ?? "@once";
          patch.run_at = w.runAt ?? null;
        }
        if (input.delivery_channel != null) {
          const channel = String(input.delivery_channel);
          if (!allowedDeliveryChannels().includes(channel))
            return { ok: false, output: `Delivery channel "${channel}" is not connected. Available: ${allowedDeliveryChannels().join(", ")}` };
          patch.delivery_channel = channel;
        }
        const task = updateTask(id, patch);
        return {
          ok: true,
          output: `Updated "${task!.name}" [${task!.id}] — ${describeWhen(task!)}.`,
          summary: `updated task "${task!.name}"`,
        };
      }

      if (op === "set_enabled") {
        const id = String(input.id || "");
        const task = getTask(id);
        if (!task) return { ok: false, output: `No task with id ${id}` };
        const enabled = input.enabled !== false && input.enabled !== "false";
        setTaskEnabled(id, enabled);
        return {
          ok: true,
          output: `${enabled ? "Enabled" : "Disabled"} "${task.name}".`,
          summary: `${enabled ? "enabled" : "disabled"} task`,
        };
      }

      if (op === "delete") {
        const id = String(input.id || "");
        const task = getTask(id);
        if (!task) return { ok: false, output: `No task with id ${id}` };
        deleteTask(id);
        return { ok: true, output: `Deleted "${task.name}".`, summary: `deleted task` };
      }

      return { ok: false, output: `Unknown operation: ${op}` };
    } catch (e: any) {
      return { ok: false, output: `schedule_task failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};

function getConvOwner(conversationId: string): string | undefined {
  try {
    return getConversation(conversationId)?.owner_user_id || undefined;
  } catch {
    return undefined;
  }
}
