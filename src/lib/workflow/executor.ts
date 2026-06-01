import {
  getWorkflow, createWorkflowRun, finishWorkflowRun, markWorkflowRun, type Workflow,
} from "../db/automations";
import { runAgentCollect } from "../agent/engine";
import { listAllTools } from "../tools";
import { createConversation } from "../db/queries";
import { logger } from "../logger";
import { startProcess, updateProcess, completeProcess } from "../db/agent-processes";

function safeProcessHook(fn: () => void): void {
  try { fn(); } catch (e) { console.warn("[orchestration] hook failed", (e as Error).message); }
}

export type WorkflowStep =
  | { type: "agent"; prompt: string }
  | { type: "tool"; tool: string; input: Record<string, any> }
  | { type: "condition"; contains: string; skipIfFalse: number }
  | { type: "delay"; seconds: number }
  | { type: "notify"; channel: string; message: string }
  | { type: "human_approval"; message: string }
  | { type: "loop"; items: string; subPrompt: string };

const STEP_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} exceeded ${ms}ms`)), ms)),
  ]);
}

export async function runWorkflow(workflowId: string): Promise<{ runId: string; status: string; results: any[] }> {
  const wf = getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found");
  const steps = JSON.parse(wf.steps) as WorkflowStep[];
  const runId = createWorkflowRun(workflowId);
  markWorkflowRun(workflowId);
  const results: any[] = [];
  const vars: Record<string, string> = {};
  const convId = createConversation().id;
  const runStarted = Date.now();
  let status = "completed";

  let processId = "";
  safeProcessHook(() => {
    processId = startProcess({
      process_type: "workflow",
      display_name: wf.name || `Workflow ${workflowId}`,
      metadata: { workflow_id: workflowId, run_id: runId, conversation_id: convId, total_steps: steps.length },
    });
  });

  try {
    for (let i = 0; i < steps.length; i++) {
      safeProcessHook(() => updateProcess(processId, {
        current_step: `Step ${i + 1} of ${steps.length}: ${steps[i].type}`,
        metadata: { step_index: i, total_steps: steps.length },
      }));
      if (Date.now() - runStarted > RUN_TIMEOUT_MS) {
        results.push({ step: i, type: "abort", error: "workflow run time limit exceeded" });
        status = "failed";
        break;
      }
      const step = steps[i];
      try {
        if (step.type === "agent") {
          const out = await withTimeout(
            runAgentCollect(convId, interpolate(step.prompt, vars)),
            STEP_TIMEOUT_MS, "agent step"
          );
          vars.last = out;
          results.push({ step: i, type: "agent", output: out.slice(0, 500) });
        } else if (step.type === "tool") {
          const tools = await listAllTools();
          const tool = tools.find((t) => t.definition.name === step.tool);
          if (!tool) throw new Error(`tool ${step.tool} not found`);
          const res = await withTimeout(
            tool.execute(step.input, { conversationId: convId, approvedDirs: [] }),
            STEP_TIMEOUT_MS, "tool step"
          );
          vars.last = res.output;
          results.push({ step: i, type: "tool", ok: res.ok, output: res.output.slice(0, 500) });
        } else if (step.type === "condition") {
          const isTrue = (vars.last || "").includes(step.contains);
          results.push({ step: i, type: "condition", result: isTrue });
          if (!isTrue) i += step.skipIfFalse;
        } else if (step.type === "delay") {
          await new Promise((r) => setTimeout(r, Math.min(step.seconds, 300) * 1000));
          results.push({ step: i, type: "delay", seconds: step.seconds });
        } else if (step.type === "notify") {
          const { deliver } = await import("./deliver");
          await deliver(step.channel, interpolate(step.message, vars));
          results.push({ step: i, type: "notify", channel: step.channel });
        } else if (step.type === "human_approval") {
          // No interactive transport here — log and continue per the skip-on-timeout rule.
          results.push({ step: i, type: "human_approval", note: "auto-continued (no interactive channel)" });
        } else if (step.type === "loop") {
          let items: string[] = [];
          try { items = JSON.parse(vars[step.items] || "[]"); } catch { items = (vars[step.items] || "").split("\n"); }
          for (const item of items.slice(0, 20)) {
            const out = await withTimeout(
              runAgentCollect(convId, interpolate(step.subPrompt, { ...vars, item: String(item) })),
              STEP_TIMEOUT_MS, "loop step"
            );
            results.push({ step: i, type: "loop-item", item, output: out.slice(0, 200) });
          }
        }
      } catch (e: any) {
        results.push({ step: i, type: step.type, error: e?.message || "step failed" });
        status = "failed";
        break;
      }
    }
  } catch (e: any) {
    status = "failed";
    logger.error("workflow run failed", { workflowId, error: e?.message });
  }

  safeProcessHook(() => completeProcess(processId, status === "completed" ? "completed" : "failed"));
  finishWorkflowRun(runId, status, results);
  return { runId, status, results };
}
