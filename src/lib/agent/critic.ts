/**
 * Agent Critic — the watchdog that keeps sub-personas honest.
 *
 * What it does
 * -------------
 * After a subagent run completes, the critic optionally reviews the run and
 * proposes lessons that should be added to that sub-persona's memory. Output
 * lands as `proposed` entries which Sora or the user can later promote to
 * `committed` (the version that gets injected into the next spawn's prompt).
 *
 * Why not auto-commit
 * -------------------
 * A judge that auto-commits its own opinions becomes a runaway feedback loop —
 * one bad review writes a bad lesson that biases all future runs. The
 * proposed → review → committed flow keeps a human-or-Sora gate. Auto-promote
 * only happens for high-confidence entries on hard failures (see decideCommit).
 *
 * Selectivity (why we don't review every run)
 * -------------------------------------------
 * Running a judge on every subagent run would double LLM cost and clutter
 * memory with noise. The critic selects runs by:
 *   - ALWAYS review hard failures (status=failed, or timeout, or tool_access
 *     denials that ended the run)
 *   - SOMETIMES review slow runs (duration > p95 of recent runs for the persona)
 *   - RARELY sample successful runs (10%) — to surface "we got lucky" patterns
 *
 * Queue + process
 * ---------------
 * On subagent completion, enqueueIfWorthwhile() decides whether to enqueue
 * into agent_critic_queue. A separate poll loop (runCriticOnce / runCriticLoop)
 * pulls pending entries and asks the local model to judge.
 *
 * This file is the SKELETON — the queue, selection heuristic, prompt template,
 * and proposal-writeback path. The actual LLM call is gated behind a feature
 * flag (CRITIC_ENABLED) so we can land the plumbing without billing tokens
 * until the rest of the pipeline is verified.
 */

import { getConfigDb } from "../db";
import { addMemory } from "../db/agent-memory";

export type CriticQueueStatus = "pending" | "reviewing" | "done" | "failed" | "skipped";

export type CriticEnqueueArgs = {
  process_id: string;          // agent_processes.process_id of the completed subagent
  persona_id: string;
  reason: string;              // why this run is worth reviewing ("failed", "p95_slow", "sampled")
};

export type CriticRating = {
  rating: 1 | 2 | 3 | 4 | 5;   // 1=harmful, 5=excellent
  confidence: number;          // 0..1
  lessons: string[];
  warnings: string[];
};

const CRITIC_ENABLED = process.env.LOCALMIND_CRITIC_ENABLED === "1";
const AUTO_COMMIT_CONFIDENCE = 0.85;
const SAMPLE_PROBABILITY = 0.10;

// ---------------------------------------------------------------------------
// Selection — should this run be reviewed?
// ---------------------------------------------------------------------------

export function shouldReview(args: {
  status: string;
  duration_ms: number;
  persona_id: string | null;
  ended_with_tool_access_request?: boolean;
}): { review: boolean; reason: string } {
  if (!args.persona_id) return { review: false, reason: "no_persona" };

  if (args.status === "failed" || args.status === "cancelled") {
    return { review: true, reason: "failed" };
  }
  if (args.ended_with_tool_access_request) {
    return { review: true, reason: "tool_access_request" };
  }

  // Slow-run gate — compare against persona's recent p95.
  try {
    const p95 = personaP95DurationMs(args.persona_id);
    if (p95 && args.duration_ms > p95 * 1.5) {
      return { review: true, reason: "p95_slow" };
    }
  } catch {
    /* p95 lookup is non-critical */
  }

  // Random sample of successful runs to surface "got lucky" patterns.
  if (Math.random() < SAMPLE_PROBABILITY) {
    return { review: true, reason: "sampled" };
  }
  return { review: false, reason: "skipped" };
}

function personaP95DurationMs(personaId: string): number | null {
  // Pull the last 50 completed subagent runs for this persona. If we have
  // fewer than 10 samples, don't bother with a p95 — too noisy.
  const rows = getConfigDb()
    .prepare(
      `SELECT (completed_at - started_at) AS duration_ms
       FROM agent_processes
       WHERE persona_id=? AND completed_at IS NOT NULL
         AND process_type IN ('chat','workflow')
       ORDER BY started_at DESC
       LIMIT 50`
    )
    .all(personaId) as { duration_ms: number }[];
  if (rows.length < 10) return null;
  const sorted = rows.map((r) => r.duration_ms).sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx] ?? null;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export function enqueueIfWorthwhile(args: CriticEnqueueArgs): boolean {
  // Dedup: same process_id won't be enqueued twice.
  const existing = getConfigDb()
    .prepare("SELECT process_id FROM agent_critic_queue WHERE process_id=?")
    .get(args.process_id);
  if (existing) return false;
  getConfigDb()
    .prepare(
      `INSERT INTO agent_critic_queue
         (process_id, persona_id, reason, enqueued_at, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(args.process_id, args.persona_id, args.reason, Date.now());
  return true;
}

export type CriticQueueRow = {
  process_id: string;
  persona_id: string;
  reason: string;
  enqueued_at: number;
  status: CriticQueueStatus;
  completed_at: number | null;
  rating: number | null;
  critic_output: string | null;
};

export function listQueue(opts: { status?: CriticQueueStatus; limit?: number } = {}): CriticQueueRow[] {
  const limit = Math.min(200, opts.limit ?? 50);
  if (opts.status) {
    return getConfigDb()
      .prepare(
        "SELECT * FROM agent_critic_queue WHERE status=? ORDER BY enqueued_at DESC LIMIT ?"
      )
      .all(opts.status, limit) as CriticQueueRow[];
  }
  return getConfigDb()
    .prepare("SELECT * FROM agent_critic_queue ORDER BY enqueued_at DESC LIMIT ?")
    .all(limit) as CriticQueueRow[];
}

function markQueueStatus(processId: string, status: CriticQueueStatus, rating: number | null, output: string | null): void {
  getConfigDb()
    .prepare(
      `UPDATE agent_critic_queue
         SET status=?, completed_at=?, rating=?, critic_output=?
       WHERE process_id=?`
    )
    .run(status, status === "done" || status === "failed" || status === "skipped" ? Date.now() : null, rating, output, processId);
}

// ---------------------------------------------------------------------------
// Auto-commit decision
// ---------------------------------------------------------------------------

function decideCommit(rating: CriticRating, reason: string): "committed" | "proposed" {
  // Auto-commit only when the critic is very sure AND the trigger was a
  // ground-truth failure. Sampling and p95 reviews always land as proposed —
  // they're suggestions, not findings.
  if (reason === "failed" && rating.confidence >= AUTO_COMMIT_CONFIDENCE) {
    return "committed";
  }
  return "proposed";
}

// ---------------------------------------------------------------------------
// Runner — pulls one queue entry, judges it, writes proposed lessons.
// ---------------------------------------------------------------------------

export async function runCriticOnce(): Promise<{ reviewed: number; reason?: string }> {
  if (!CRITIC_ENABLED) return { reviewed: 0, reason: "disabled" };

  const next = getConfigDb()
    .prepare(
      "SELECT * FROM agent_critic_queue WHERE status='pending' ORDER BY enqueued_at ASC LIMIT 1"
    )
    .get() as CriticQueueRow | undefined;
  if (!next) return { reviewed: 0, reason: "empty" };

  markQueueStatus(next.process_id, "reviewing", null, null);

  try {
    const rating = await judgeSubagentRun(next.process_id, next.persona_id, next.reason);
    if (!rating) {
      markQueueStatus(next.process_id, "skipped", null, "no rating produced");
      return { reviewed: 0, reason: "no_rating" };
    }

    const status = decideCommit(rating, next.reason);
    for (const lesson of rating.lessons) {
      addMemory({
        persona_id: next.persona_id,
        kind: "lesson",
        content: lesson,
        status,
        created_by: "system",
        confidence: rating.confidence,
        source_subagent_process_id: next.process_id,
      });
    }
    for (const w of rating.warnings) {
      addMemory({
        persona_id: next.persona_id,
        kind: "warning",
        content: w,
        status,
        created_by: "system",
        confidence: rating.confidence,
        source_subagent_process_id: next.process_id,
      });
    }
    markQueueStatus(next.process_id, "done", rating.rating, JSON.stringify(rating));
    return { reviewed: 1 };
  } catch (e) {
    markQueueStatus(next.process_id, "failed", null, (e as Error).message);
    return { reviewed: 0, reason: "errored" };
  }
}

/**
 * The actual LLM call. Stubbed for now — a follow-up pass wires this to the
 * local model with a structured-output schema. We keep the function shape
 * stable so the queue + writeback above can be exercised end-to-end with a
 * mock during development.
 */
async function judgeSubagentRun(
  _processId: string,
  _personaId: string,
  _reason: string
): Promise<CriticRating | null> {
  // TODO: wire to local model. For now we return null so production behavior is
  // a no-op even when LOCALMIND_CRITIC_ENABLED=1 but the model isn't wired.
  return null;
}
