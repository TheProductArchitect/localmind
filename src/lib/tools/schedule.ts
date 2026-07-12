import { nlToCron, describeCron, cronMatches } from "../cron";
import {
  listTasks,
  getTask,
  createTask,
  setTaskEnabled,
  deleteTask,
  updateTask,
} from "../db/automations";
import { listChannels } from "../db/channels";
import { getConversation } from "../db/queries";
import type { Tool } from "./types";

// A 5-field cron ("min hour dom mon dow"). If the schedule already looks like
// one we pass it through; otherwise we run it through the NL → cron converter.
function isCronExpr(s: string): boolean {
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return cronMatches(parts.join(" "), new Date()) || /^[\d*/,\-\s]+$/.test(s.trim());
}

function resolveCron(schedule: string): string {
  const s = String(schedule || "").trim();
  return isCronExpr(s) ? s : nlToCron(s);
}

// Channels a task may deliver through. "browser" is always available (the run
// just surfaces in-app); the rest must be enabled in Settings → Channels.
function allowedDeliveryChannels(): string[] {
  const enabled = listChannels().filter((c) => c.enabled).map((c) => c.type);
  return ["browser", ...enabled];
}

export const scheduleTool: Tool = {
  actionType: "schedule_write",
  classify: (i) => {
    const op = String(i.operation || "");
    if (op === "list") return "read_schedule";
    if (op === "delete") return "delete_automation";
    return "schedule_write";
  },
  preview: (i) => {
    const op = String(i.operation || "");
    if (op === "create" || op === "update") {
      const cron = i.schedule ? resolveCron(String(i.schedule)) : null;
      const when = cron ? ` — runs ${describeCron(cron)}` : "";
      const via = i.delivery_channel ? `, delivers via ${i.delivery_channel}` : "";
      return `${op === "create" ? "Create" : "Update"} scheduled task "${i.name ?? i.id ?? ""}"${when}${via}`;
    }
    if (op === "set_enabled") return `${i.enabled === false ? "Disable" : "Enable"} scheduled task ${i.id}`;
    if (op === "delete") return `Delete scheduled task ${i.id}`;
    return "List scheduled tasks";
  },
  definition: {
    name: "schedule_task",
    description:
      "Create and manage recurring scheduled tasks so you can run work for the user on a cadence (e.g. a morning briefing). " +
      "Prefer this over telling the user to set a reminder manually. Operations: create, list, update, set_enabled, delete. " +
      "For `schedule`, pass natural language (\"every weekday at 7:30\") or a 5-field cron; it is resolved to cron and the human-readable time is shown for confirmation. " +
      "Creating or updating a recurring task always requires the user's confirmation because it commits you to future autonomous runs.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "list", "update", "set_enabled", "delete"] },
        id: { type: "string", description: "Task id (update/set_enabled/delete)" },
        name: { type: "string", description: "Short task name (create/update)" },
        schedule: {
          type: "string",
          description: "Natural language (\"weekdays at 7:30\") or 5-field cron (create/update)",
        },
        prompt: {
          type: "string",
          description: "What the assistant should do each run (create/update)",
        },
        delivery_channel: {
          type: "string",
          description: "Where to deliver output: browser (default), telegram, email, … (must be an enabled channel)",
        },
        enabled: { type: "boolean", description: "For set_enabled" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const op = String(input.operation || "");
    try {
      if (op === "list") {
        const tasks = listTasks();
        if (tasks.length === 0) return { ok: true, output: "(no scheduled tasks)", summary: "no tasks" };
        const lines = tasks.map(
          (t) =>
            `- [${t.id}] ${t.name} — ${describeCron(t.cron)} via ${t.delivery_channel}` +
            `${t.enabled ? "" : " (disabled)"}${t.last_run_at ? ` · last run ${new Date(t.last_run_at).toISOString()}` : ""}`
        );
        return { ok: true, output: lines.join("\n"), summary: `${tasks.length} task(s)` };
      }

      if (op === "create") {
        const name = String(input.name || "").trim();
        const prompt = String(input.prompt || "").trim();
        const schedule = String(input.schedule || "").trim();
        if (!name || !prompt || !schedule)
          return { ok: false, output: "name, schedule, and prompt are required" };
        const cron = resolveCron(schedule);
        const channel = String(input.delivery_channel || "browser");
        const allowed = allowedDeliveryChannels();
        if (!allowed.includes(channel))
          return {
            ok: false,
            output: `Delivery channel "${channel}" is not enabled. Available: ${allowed.join(", ")}`,
          };
        const owner = getConvOwner(ctx.conversationId);
        const task = createTask({ name, cron, prompt, delivery_channel: channel, creator: owner });
        return {
          ok: true,
          output: `Created task "${task.name}" [${task.id}] — ${describeCron(cron)} (cron: ${cron}), delivers via ${channel}.`,
          summary: `scheduled "${task.name}" ${describeCron(cron)}`,
        };
      }

      if (op === "update") {
        const id = String(input.id || "");
        if (!getTask(id)) return { ok: false, output: `No task with id ${id}` };
        const patch: { name?: string; cron?: string; prompt?: string; delivery_channel?: string } = {};
        if (input.name != null) patch.name = String(input.name);
        if (input.prompt != null) patch.prompt = String(input.prompt);
        if (input.schedule != null) patch.cron = resolveCron(String(input.schedule));
        if (input.delivery_channel != null) {
          const channel = String(input.delivery_channel);
          const allowed = allowedDeliveryChannels();
          if (!allowed.includes(channel))
            return { ok: false, output: `Delivery channel "${channel}" is not enabled. Available: ${allowed.join(", ")}` };
          patch.delivery_channel = channel;
        }
        const task = updateTask(id, patch);
        return {
          ok: true,
          output: `Updated task "${task!.name}" [${task!.id}] — ${describeCron(task!.cron)} (cron: ${task!.cron}).`,
          summary: `updated task "${task!.name}"`,
        };
      }

      if (op === "set_enabled") {
        const id = String(input.id || "");
        const task = getTask(id);
        if (!task) return { ok: false, output: `No task with id ${id}` };
        const enabled = input.enabled !== false;
        setTaskEnabled(id, enabled);
        return {
          ok: true,
          output: `${enabled ? "Enabled" : "Disabled"} task "${task.name}".`,
          summary: `${enabled ? "enabled" : "disabled"} task`,
        };
      }

      if (op === "delete") {
        const id = String(input.id || "");
        const task = getTask(id);
        if (!task) return { ok: false, output: `No task with id ${id}` };
        deleteTask(id);
        return { ok: true, output: `Deleted task "${task.name}".`, summary: `deleted task` };
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
