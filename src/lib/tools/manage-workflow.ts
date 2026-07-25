import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from "../db/automations";
import { runWorkflow, type WorkflowStep } from "../workflow/executor";
import type { Tool } from "./types";

const STEP_TYPES = new Set([
  "agent",
  "tool",
  "condition",
  "delay",
  "notify",
  "human_approval",
  "loop",
]);

function validateSteps(steps: unknown): { ok: true; steps: WorkflowStep[] } | { ok: false; error: string } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, error: "steps must be a non-empty array" };
  }
  if (steps.length > 40) return { ok: false, error: "too many steps (max 40)" };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as any;
    if (!s || typeof s !== "object" || !STEP_TYPES.has(s.type)) {
      return { ok: false, error: `step ${i}: invalid type (want ${[...STEP_TYPES].join("|")})` };
    }
  }
  return { ok: true, steps: steps as WorkflowStep[] };
}

/** True when steps may send outbound messages or drive a raw browser. */
export function stepsNeedConfirm(steps: WorkflowStep[]): boolean {
  return steps.some((s) => {
    if (s.type === "notify") {
      const ch = String((s as any).channel || "").toLowerCase();
      return ch === "email" || ch === "telegram" || ch === "sms" || ch === "whatsapp";
    }
    if (s.type === "tool") {
      const name = String((s as any).tool || "");
      return name === "browser" || name === "email" || name === "install_mcp_server";
    }
    return false;
  });
}

export const manageWorkflowTool: Tool = {
  actionType: "schedule_write",
  forcedTier: undefined,
  preview: (i) => {
    const op = String(i.operation || "list");
    if (op === "create") return `Create workflow: ${i.name || "(unnamed)"}`;
    if (op === "run_once") return `Run workflow ${i.workflow_id || i.id}`;
    if (op === "delete") return `Delete workflow ${i.workflow_id || i.id}`;
    return `Workflow ${op}`;
  },
  classify: (i) => {
    const op = String(i.operation || "list").toLowerCase();
    if (op === "list" || op === "get") return "schedule_write";
    if (op === "create" || op === "update") {
      const steps = Array.isArray(i.steps) ? (i.steps as WorkflowStep[]) : [];
      if (stepsNeedConfirm(steps)) return "send_email";
    }
    if (op === "delete") return "delete_automation";
    return "schedule_write";
  },
  version: "1",
  definition: {
    name: "manage_workflow",
    description:
      "Create, list, update, enable/disable, or run multi-step automations (workflows). Use for recurring digests, scrape→notify pipelines, and reminder emails. Prefer schedule_task for simple one-prompt reminders. Steps may be agent | tool | condition | delay | notify | human_approval | loop.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "list | get | create | update | enable | disable | run_once | delete",
        },
        workflow_id: { type: "string", description: "Workflow id for get/update/run/delete/enable/disable" },
        id: { type: "string", description: "Alias for workflow_id" },
        name: { type: "string" },
        trigger_type: { type: "string", description: "manual | schedule" },
        cron: { type: "string", description: "When trigger_type=schedule, 5-field cron or NL schedule stored in trigger_config" },
        steps: {
          type: "array",
          description: "Workflow steps",
          items: { type: "object" },
        },
        enabled: { type: "boolean" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const op = String(input.operation || "list").toLowerCase().trim();
    const id = String(input.workflow_id || input.id || "").trim();

    if (op === "list") {
      const rows = listWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        trigger_type: w.trigger_type,
        enabled: !!w.enabled,
        last_run_at: w.last_run_at,
      }));
      return { ok: true, output: JSON.stringify(rows, null, 2), summary: `${rows.length} workflows` };
    }

    if (op === "get") {
      if (!id) return { ok: false, output: "workflow_id required", summary: "missing id" };
      const w = getWorkflow(id);
      if (!w) return { ok: false, output: "not found", summary: "missing" };
      return { ok: true, output: JSON.stringify(w, null, 2), summary: w.name };
    }

    if (op === "create") {
      const name = String(input.name || "").trim();
      if (!name) return { ok: false, output: "name required", summary: "missing name" };
      const validated = validateSteps(input.steps);
      if (!validated.ok) return { ok: false, output: validated.error, summary: "bad steps" };
      const trigger_type = String(input.trigger_type || "manual");
      const trigger_config =
        trigger_type === "schedule"
          ? { cron: String(input.cron || "0 9 * * *") }
          : {};
      const w = createWorkflow({
        name,
        trigger_type,
        trigger_config,
        steps: validated.steps,
      });
      return {
        ok: true,
        output: `Created workflow ${w.id} (${w.name}). Steps: ${validated.steps.length}.`,
        summary: `created ${w.id}`,
      };
    }

    if (op === "update") {
      if (!id) return { ok: false, output: "workflow_id required", summary: "missing id" };
      const patch: Parameters<typeof updateWorkflow>[1] = {};
      if (input.name) patch.name = String(input.name);
      if (input.trigger_type) patch.trigger_type = String(input.trigger_type);
      if (input.cron) patch.trigger_config = { cron: String(input.cron) };
      if (input.steps !== undefined) {
        const validated = validateSteps(input.steps);
        if (!validated.ok) return { ok: false, output: validated.error, summary: "bad steps" };
        patch.steps = validated.steps;
      }
      if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
      updateWorkflow(id, patch);
      return { ok: true, output: `Updated workflow ${id}`, summary: "updated" };
    }

    if (op === "enable" || op === "disable") {
      if (!id) return { ok: false, output: "workflow_id required", summary: "missing id" };
      updateWorkflow(id, { enabled: op === "enable" });
      return { ok: true, output: `${op}d ${id}`, summary: op };
    }

    if (op === "delete") {
      if (!id) return { ok: false, output: "workflow_id required", summary: "missing id" };
      deleteWorkflow(id);
      return { ok: true, output: `Deleted ${id}`, summary: "deleted" };
    }

    if (op === "run_once") {
      if (!id) return { ok: false, output: "workflow_id required", summary: "missing id" };
      const result = await runWorkflow(id);
      return {
        ok: result.status === "completed" || result.status === "awaiting_approval",
        output: JSON.stringify(result).slice(0, 4000),
        summary: result.status,
      };
    }

    return {
      ok: false,
      output: `Unknown operation "${op}". Use list|get|create|update|enable|disable|run_once|delete.`,
      summary: "bad op",
    };
  },
};
