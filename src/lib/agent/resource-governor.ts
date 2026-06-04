/**
 * Resource governor — produces an ADVISORY recommendation for how many
 * subagents Sora should run in parallel, plus recent-performance signals so
 * she can adapt based on what's actually worked on this hardware.
 *
 * V6.9 change: the governor's number is no longer a hard cap. It's a
 * parameter Sora considers alongside recent performance history. A
 * SANITY_FLOOR (16 concurrent) still applies inside spawn_subagents_parallel
 * so even a confused model can't DoS the box, but typical decisions are
 * Sora's, informed by the governor + the perf rollup.
 *
 * Inputs:
 *   - free RAM (os.freemem / os.totalmem)
 *   - currently-active subagent count (from agent_processes)
 *   - active model footprint (rough estimate from model name pattern)
 *   - user's configured concurrency cap (from settings, if present)
 *   - recent subagent performance (last hour: success rate, avg duration,
 *     batch-size outcomes) — drives the "what's actually worked" feedback
 *
 * Outputs:
 *   - recommended_max: the governor's suggestion (advisory, not enforced)
 *   - sanity_ceiling: 16 — hard ceiling Sora cannot exceed under any cond.
 *   - structured reason + warnings + recent performance digest
 */

import os from "os";
import { listActive } from "../db/agent-processes";
import { getConfigDb } from "../db";

const GB = 1024 ** 3;

export type ResourceSnapshot = {
  ram: {
    total_gb: number;
    free_gb: number;
    used_gb: number;
    used_pct: number;
  };
  active_subagents: number;
  active_processes_total: number;
  active_model: { name: string; est_ram_gb: number } | null;
  ollama_likely_running: boolean;
};

export type CapacityDecision = {
  max_concurrent: number;
  user_setting: number | null;
  reason: string;
  warnings: string[];
  snapshot: ResourceSnapshot;
};

/**
 * Rough RAM footprint for a model. Reads the size out of the name
 * (`llama3.2:3b` → ~3 GB, `qwen2.5:14b` → ~14 GB, etc.). Returns 4 GB
 * if the name carries no size hint — a reasonable default for a base-sized
 * local model.
 */
function estimateModelRamGb(name: string | null): number {
  if (!name) return 4;
  const m = name.match(/(\d+(?:\.\d+)?)b/i);
  if (m) {
    const b = parseFloat(m[1]);
    // Quantised local models run at roughly 0.7–1× their parameter count
    // in GB. We use 0.9 as a conservative middle.
    return Math.max(1, Math.round(b * 0.9));
  }
  return 4;
}

/**
 * Probe Ollama once to know if it's reachable. Cheap (2s timeout); falls back
 * to "not running" on any error. Cached for 5 seconds since this is queried
 * on every capacity decision.
 */
let cachedOllamaProbe: { at: number; running: boolean } | null = null;
const OLLAMA_PROBE_TTL_MS = 5_000;
async function probeOllama(): Promise<boolean> {
  if (cachedOllamaProbe && Date.now() - cachedOllamaProbe.at < OLLAMA_PROBE_TTL_MS) {
    return cachedOllamaProbe.running;
  }
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    const running = r.ok;
    cachedOllamaProbe = { at: Date.now(), running };
    return running;
  } catch {
    cachedOllamaProbe = { at: Date.now(), running: false };
    return false;
  }
}

export async function snapshotResources(): Promise<ResourceSnapshot> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  const active = listActive(null);
  const subagents = active.filter((p) =>
    p.display_name?.toLowerCase().startsWith("subagent") ||
    p.agent_name === "Subagent" ||
    (() => {
      try {
        const m = JSON.parse(p.metadata_json) as { kind?: string };
        return m.kind === "subagent";
      } catch { return false; }
    })()
  );

  // Active model: read from settings. If unset, no estimate.
  let activeModel: ResourceSnapshot["active_model"] = null;
  try {
    const { getSettings } = await import("../db/queries");
    const s = getSettings();
    if (s.active_model) {
      activeModel = { name: s.active_model, est_ram_gb: estimateModelRamGb(s.active_model) };
    }
  } catch { /* falls through */ }

  const ollama_likely_running = await probeOllama();

  return {
    ram: {
      total_gb: Math.round((total / GB) * 10) / 10,
      free_gb: Math.round((free / GB) * 10) / 10,
      used_gb: Math.round((used / GB) * 10) / 10,
      used_pct: Math.round((used / total) * 100),
    },
    active_subagents: subagents.length,
    active_processes_total: active.length,
    active_model: activeModel,
    ollama_likely_running,
  };
}

/**
 * The actual cap decision. Caller pass `requested_max` (what Sora asked for);
 * we return the floor.
 */
export async function decideCapacity(requestedMax: number = 8): Promise<CapacityDecision> {
  const snap = await snapshotResources();
  const warnings: string[] = [];

  // Step 1: start from user setting (if present in DB) or default to 2 / 3 / 4
  // by total RAM tier.
  let userSetting: number | null = null;
  try {
    const { getSettings } = await import("../db/queries");
    const s = getSettings() as unknown as { max_concurrent_processes?: number };
    if (typeof s.max_concurrent_processes === "number" && s.max_concurrent_processes > 0) {
      userSetting = s.max_concurrent_processes;
    }
  } catch { /* ignore */ }

  const tierDefault = snap.ram.total_gb >= 32 ? 4 : snap.ram.total_gb >= 16 ? 3 : 2;
  let cap = userSetting ?? tierDefault;
  let reason = userSetting !== null ? `user setting: ${userSetting}` : `RAM tier default: ${tierDefault} (${snap.ram.total_gb} GB total)`;

  // Step 2: clamp by what Sora actually asked for.
  if (requestedMax < cap) {
    cap = requestedMax;
    reason = `requested ${requestedMax} (within governor budget)`;
  }

  // Step 3: subtract already-running subagents so we don't double-spend.
  if (snap.active_subagents > 0) {
    const before = cap;
    cap = Math.max(0, cap - snap.active_subagents);
    if (cap < before) {
      reason = `reduced from ${before} to ${cap} — ${snap.active_subagents} subagent(s) already running`;
    }
  }

  // Step 4: RAM-pressure clamp. The model's footprint × concurrency must fit
  // in free RAM with at least 1 GB headroom.
  if (snap.active_model) {
    const perAgent = snap.active_model.est_ram_gb;
    const headroom = 1; // GB
    const ramBudget = Math.max(0, snap.ram.free_gb - headroom);
    const ramAllowed = Math.max(1, Math.floor(ramBudget / Math.max(1, perAgent)));
    if (cap > ramAllowed) {
      warnings.push(
        `RAM pressure: ${snap.ram.free_gb} GB free, model uses ~${perAgent} GB each — limiting to ${ramAllowed} concurrent`
      );
      cap = ramAllowed;
      reason = `RAM-limited to ${ramAllowed}`;
    }
  } else if (snap.ram.used_pct > 85) {
    warnings.push(`RAM ${snap.ram.used_pct}% used — limiting to 1 concurrent`);
    cap = 1;
    reason = "high RAM pressure";
  }

  // Step 5: Ollama check. If Ollama isn't responding, the model dispatch will
  // queue everything anyway — keep cap≥1 but warn.
  if (!snap.ollama_likely_running) {
    warnings.push("Ollama doesn't appear to be running locally — subagents that need the model will fail; consider running them later");
  }

  // Step 6: never zero.
  cap = Math.max(1, cap);

  return {
    max_concurrent: cap,
    user_setting: userSetting,
    reason,
    warnings,
    snapshot: snap,
  };
}

/**
 * SANITY_CEILING — the absolute hardest cap, regardless of what Sora asks
 * for or what the governor's advice is. Even a confused model can't spawn
 * 1000 agents. 16 is generous; typical decisions are well below this.
 */
export const SANITY_CEILING = 16;

// -----------------------------------------------------------------------------
// Recent subagent performance — the signal Sora uses to ADAPT her decisions.
// -----------------------------------------------------------------------------

export type SubagentRun = {
  process_id: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  status: string;
  batch_size: number;
  depth: number;
  free_ram_gb_at_start: number | null;
};

export type SubagentPerformanceRollup = {
  window_minutes: number;
  total_runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  success_rate: number;            // 0..1, NaN if total_runs == 0
  median_duration_ms: number | null;
  p95_duration_ms: number | null;
  by_batch_size: Array<{
    batch_size: number;
    runs: number;
    success_rate: number;
    median_duration_ms: number | null;
  }>;
  /** Distinct failure messages and how many runs hit them. */
  failure_reasons: Array<{ reason: string; count: number }>;
  /** A short human-readable interpretation for Sora's prompt context. */
  summary: string;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function p95(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

/**
 * Roll up recent subagent runs from agent_processes. Filters to rows tagged
 * with kind="subagent" in metadata_json. Default window is the last 60 minutes
 * — long enough to capture pattern, short enough to reflect current
 * hardware state.
 */
export function recentSubagentPerformance(windowMinutes = 60, limit = 200): SubagentPerformanceRollup {
  const since = Date.now() - windowMinutes * 60_000;
  const rows = getConfigDb()
    .prepare(
      `SELECT process_id, started_at, completed_at, status, metadata_json
       FROM agent_processes
       WHERE started_at >= ?
         AND (
           agent_name = 'Subagent'
           OR display_name LIKE 'Subagent:%'
           OR metadata_json LIKE '%"kind":"subagent"%'
         )
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(since, limit) as Array<{
      process_id: string;
      started_at: number;
      completed_at: number | null;
      status: string;
      metadata_json: string;
    }>;

  const runs: SubagentRun[] = rows.map((r) => {
    let meta: { batch_size?: number; depth?: number; free_ram_gb_at_start?: number } = {};
    try { meta = JSON.parse(r.metadata_json || "{}"); } catch { /* defaults */ }
    return {
      process_id: r.process_id,
      started_at: r.started_at,
      completed_at: r.completed_at,
      duration_ms: r.completed_at ? r.completed_at - r.started_at : null,
      status: r.status,
      batch_size: meta.batch_size ?? 1,
      depth: meta.depth ?? 1,
      free_ram_gb_at_start: meta.free_ram_gb_at_start ?? null,
    };
  });

  const total = runs.length;
  const succeeded = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const cancelled = runs.filter((r) => r.status === "cancelled").length;

  const successDurations = runs
    .filter((r) => r.status === "completed" && typeof r.duration_ms === "number")
    .map((r) => r.duration_ms as number);

  // Group by batch_size for the "what's worked" signal.
  const groups = new Map<number, SubagentRun[]>();
  for (const r of runs) {
    const arr = groups.get(r.batch_size) ?? [];
    arr.push(r);
    groups.set(r.batch_size, arr);
  }
  const by_batch_size = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bs, group]) => {
      const ok = group.filter((g) => g.status === "completed").length;
      const dur = group
        .filter((g) => g.status === "completed" && typeof g.duration_ms === "number")
        .map((g) => g.duration_ms as number);
      return {
        batch_size: bs,
        runs: group.length,
        success_rate: group.length > 0 ? ok / group.length : 0,
        median_duration_ms: median(dur),
      };
    });

  // Failure reasons aren't currently stored in metadata. Best signal is
  // last_error on the agent_processes row — for now we surface status.
  const failureReasons = new Map<string, number>();
  for (const r of runs) {
    if (r.status === "failed" || r.status === "cancelled") {
      const key = r.status;
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }
  }

  const successRate = total > 0 ? succeeded / total : NaN;
  const med = median(successDurations);
  const p = p95(successDurations);

  // Short summary string for Sora's prompt context. Pithy, concrete.
  let summary: string;
  if (total === 0) {
    summary = `No subagents have run in the last ${windowMinutes} min — no performance history yet.`;
  } else {
    const ratePct = Math.round(successRate * 100);
    const medS = med ? (med / 1000).toFixed(1) : "—";
    const best = by_batch_size
      .filter((g) => g.runs >= 2 && g.success_rate >= 0.8)
      .sort((a, b) => b.batch_size - a.batch_size)[0];
    const bestStr = best ? `Largest batch with ≥80% success: ${best.batch_size} (${best.runs} runs, ${Math.round(best.success_rate * 100)}% ok).` : "";
    summary = `${total} subagent runs in last ${windowMinutes} min: ${ratePct}% success, median ${medS}s. ${bestStr}`.trim();
  }

  return {
    window_minutes: windowMinutes,
    total_runs: total,
    succeeded,
    failed,
    cancelled,
    success_rate: successRate,
    median_duration_ms: med,
    p95_duration_ms: p,
    by_batch_size,
    failure_reasons: [...failureReasons.entries()].map(([reason, count]) => ({ reason, count })),
    summary,
  };
}

/**
 * Convenience: governor advice + recent performance in one fetch. Used by the
 * check_resources tool so Sora gets both signals together.
 */
export async function advisoryAndHistory(requestedMax: number = 8): Promise<{
  decision: CapacityDecision;
  performance: SubagentPerformanceRollup;
  sanity_ceiling: number;
}> {
  const [decision, performance] = await Promise.all([
    decideCapacity(requestedMax),
    Promise.resolve(recentSubagentPerformance(60)),
  ]);
  return { decision, performance, sanity_ceiling: SANITY_CEILING };
}
