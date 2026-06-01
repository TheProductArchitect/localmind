/**
 * Long-running job executor. Drives an open-ended agent loop:
 *
 *   ┌──── iteration N ────────────────────────────────────────┐
 *   │ 1. drain any pending injects, push as user messages     │
 *   │ 2. run a single agent turn (runAgentCollect)            │
 *   │ 3. write a checkpoint (conversation snapshot, status)   │
 *   │ 4. check stopping conditions                             │
 *   │ 5. if continuing, loop back                              │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Checkpoints land in the `job_checkpoints` table after every iteration so a
 * crash, app restart, or kill can resume from the last good state.
 *
 * Termination conditions, in priority order:
 *   - status flipped to 'cancelled' or 'paused' externally
 *   - max_iterations reached
 *   - max_duration_hours exceeded
 *   - stopping_condition 'natural': agent emits a STOP marker
 *   - stopping_condition matches: agent's last response contains the literal
 */

import { runAgentCollect } from "./engine";
import {
  getJob,
  drainInjects,
  writeCheckpoint,
  latestCheckpoint,
  setJobConversation,
  setJobProcess,
  updateJobStatus,
  type LongJob,
} from "../db/long-running-jobs";
import { createConversation, addMessage, getMessages } from "../db/queries";
import {
  startProcess,
  updateProcess,
  completeProcess,
} from "../db/agent-processes";

const NATURAL_STOP_MARKERS = [
  "[[done]]",
  "[task complete]",
  "<task_complete>",
  "<<<job-complete>>>",
];

function naturalStopReached(text: string): boolean {
  const t = text.toLowerCase();
  return NATURAL_STOP_MARKERS.some((m) => t.includes(m.toLowerCase()));
}

function buildJobSystemPrefix(job: LongJob, iteration: number): string {
  const tools = safeArr(job.allowed_tools);
  return [
    `You are running as a long-running job named "${job.job_name}".`,
    ``,
    `Goal: ${job.goal}`,
    ``,
    `Allowed tools for this job: ${tools.length ? tools.join(", ") : "(default set)"}.`,
    `Maximum iterations: ${job.max_iterations}. Current iteration: ${iteration}.`,
    `Stopping condition: ${job.stopping_condition}.`,
    ``,
    `Make incremental, verifiable progress each turn. At the end of every turn, briefly state in plain English what you accomplished and what remains. When the goal is achieved, end your turn with the literal marker [[DONE]] on its own line.`,
    `If you cannot make progress, end your turn with [[DONE]] and explain why.`,
  ].join("\n");
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Resume or start a job by id. Returns when the job completes, fails, is
 * cancelled, or hits a limit. Idempotent: if the job is already 'completed'
 * or 'cancelled', returns immediately.
 */
export async function runJob(jobId: string): Promise<void> {
  let job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (["completed", "failed", "cancelled"].includes(job.status)) return;

  // Establish conversation + agent_process row (idempotent across resumes).
  if (!job.conversation_id) {
    const conv = createConversation(undefined, job.owner_user_id || undefined);
    setJobConversation(jobId, conv.id);
    job = getJob(jobId)!;
  }
  if (!job.process_id) {
    const pid = startProcess({
      process_type: "long_running_job",
      display_name: job.job_name,
      owner_user_id: job.owner_user_id || null,
      agent_name: "Job runner",
      metadata: { job_id: jobId, conversation_id: job.conversation_id, goal: job.goal.slice(0, 120) },
    });
    setJobProcess(jobId, pid);
    job = getJob(jobId)!;
  }
  const processId = job.process_id!;
  const conversationId = job.conversation_id!;

  // On a fresh job (no checkpoint yet) seed the conversation with the goal so
  // the agent has it in history even though the system prefix already states it.
  if (!latestCheckpoint(jobId)) {
    addMessage({
      conversation_id: conversationId,
      role: "user",
      content: `Begin working toward the following goal:\n\n${job.goal}\n\nMake one increment of progress this turn, then summarise.`,
      token_count: Math.ceil(job.goal.length / 4),
      parent_message_id: null,
    });
  }

  updateJobStatus(jobId, "running");
  updateProcess(processId, { status: "running", current_step: "starting job loop" });

  const deadlineAt = job.created_at + job.max_duration_hours * 3600_000;
  let iteration = job.current_iteration || 0;
  let lastAssistant = "";

  try {
    while (true) {
      // Re-read job each iteration to honour external pause/cancel/inject.
      job = getJob(jobId);
      if (!job) throw new Error("Job vanished mid-run");

      if (job.status === "cancelled") {
        updateProcess(processId, { current_step: "cancelled" });
        break;
      }
      if (job.status === "paused") {
        updateProcess(processId, { status: "paused", current_step: `paused at iteration ${iteration}` });
        // Job runner is single-threaded — leave the loop and rely on a resume to re-enqueue.
        return;
      }
      if (iteration >= job.max_iterations) {
        updateProcess(processId, { current_step: `iteration limit (${job.max_iterations}) reached` });
        updateJobStatus(jobId, "completed");
        break;
      }
      if (Date.now() > deadlineAt) {
        updateProcess(processId, { current_step: `duration limit (${job.max_duration_hours}h) reached` });
        updateJobStatus(jobId, "completed");
        break;
      }

      iteration += 1;
      updateProcess(processId, {
        status: "running",
        current_step: `iteration ${iteration} / ${job.max_iterations}`,
      });

      // Drain any injected user instructions before the iteration runs.
      const injects = drainInjects(jobId);
      for (const msg of injects) {
        addMessage({
          conversation_id: conversationId,
          role: "user",
          content: `[user inject] ${msg}`,
          token_count: Math.ceil(msg.length / 4),
          parent_message_id: null,
        });
      }

      const continuationPrompt = injects.length
        ? `Acknowledge and act on the user's injected instructions above, then continue toward the goal.`
        : `Continue toward the goal. Make incremental progress, then summarise and either continue or emit [[DONE]].`;

      const response = await runAgentCollect(conversationId, continuationPrompt, {
        systemPrefix: buildJobSystemPrefix(job, iteration),
      });
      lastAssistant = response;

      // Snapshot the conversation right after the agent turn — this is what a
      // resume will load. Storing message ids (not bodies) keeps checkpoints
      // small while still being deterministic, since messages live in conv.db.
      const messages = getMessages(conversationId).map((m) => ({ id: m.id, role: m.role, created_at: m.created_at }));
      const statusBlurb = response.slice(0, 200).replace(/\s+/g, " ").trim();
      writeCheckpoint({
        job_id: jobId,
        iteration,
        conversation_snapshot: { conversationId, messages },
        status_description: statusBlurb,
      });

      // Stopping conditions.
      if (naturalStopReached(response)) {
        updateJobStatus(jobId, "completed");
        updateProcess(processId, { current_step: "agent emitted stop marker" });
        break;
      }
      if (
        job.stopping_condition &&
        job.stopping_condition !== "natural" &&
        response.toLowerCase().includes(job.stopping_condition.toLowerCase())
      ) {
        updateJobStatus(jobId, "completed");
        updateProcess(processId, { current_step: "stopping condition matched" });
        break;
      }
    }

    const finalStatus = (getJob(jobId)?.status as LongJob["status"] | undefined) || "completed";
    completeProcess(
      processId,
      finalStatus === "cancelled" ? "cancelled" : "completed"
    );
    if (finalStatus === "running") updateJobStatus(jobId, "completed");
  } catch (e) {
    updateJobStatus(jobId, "failed");
    completeProcess(processId, "failed");
    console.warn(`[job-executor] job ${jobId} failed:`, (e as Error).message);
  }

  // Best-effort notification echo into the conversation so the user sees it.
  if (lastAssistant) {
    try {
      addMessage({
        conversation_id: conversationId,
        role: "assistant",
        content: `[job summary] ${lastAssistant.slice(0, 600)}`,
        token_count: 0,
        parent_message_id: null,
      });
    } catch { /* non-fatal */ }
  }
}

/**
 * On app startup, mark any 'running' jobs as 'pending' so the worker re-enqueues
 * them. We can't just call runJob() here because it would block startup — we
 * defer to the existing `jobs` queue which the PM2 worker polls every tick.
 */
export function bootResumeOrphanedJobs(enqueueJob: (type: string, payload: Record<string, unknown>) => string): number {
  const { listResumable } = require("../db/long-running-jobs") as typeof import("../db/long-running-jobs");
  const jobs = listResumable();
  let count = 0;
  for (const j of jobs) {
    if (j.status === "running") {
      updateJobStatus(j.job_id, "pending");
      enqueueJob("long_running_job", { jobId: j.job_id });
      count++;
    }
  }
  return count;
}
