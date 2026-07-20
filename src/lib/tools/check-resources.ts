/**
 * check_resources — Sora calls this BEFORE deciding how to fan out work.
 *
 * Returns a snapshot of current hardware + a capacity recommendation from the
 * governor. Sora uses this to decide whether to:
 *   - Run one task at a time (low RAM, big model, system under pressure)
 *   - Spawn a small parallel batch (typical home machine, 16 GB RAM, base model)
 *   - Spawn larger parallel batches (homelab with 32+ GB RAM, multiple loaded models)
 *
 * The output is concise and structured for the model to reason about — not a
 * dump of every metric. If a user wants raw metrics, they have the System
 * Dashboard for that.
 *
 * Always cacheable: the snapshot reflects the moment of the call. The cache
 * key includes the operation arg only, so two calls within a single agent
 * turn return the same value (no point re-probing in the same turn). The
 * cache wrapper's LRU TTL bounds staleness naturally.
 */

import type { Tool } from "./types";
import { advisoryAndHistory } from "../agent/resource-governor";

export const checkResourcesTool: Tool = {
  actionType: "memory_read",
  classify: () => "memory_read",
  preview: () => "Check current memory, active model, and recommended parallel-spawn capacity",
  version: "1",
  cacheable: () => true,
  definition: {
    name: "check_resources",
    description:
      "Get a safe parallel-subagent count based on current RAM and active model. Call before spawn_subagents_parallel when batch size is uncertain. Prefer spawn_subagents_sequential when speedup is not needed. max_concurrent is a hard ceiling for parallel only.",
    parameters: {
      type: "object",
      properties: {
        requested_max: {
          type: "number",
          description: "How many you're considering. Governor returns this or fewer. Default 8.",
        },
      },
    },
  },
  async execute(input) {
    const requested = typeof input.requested_max === "number" ? Math.max(1, Math.min(64, input.requested_max)) : 8;
    const { decision, performance, sanity_ceiling } = await advisoryAndHistory(requested);

    const lines: string[] = [];
    lines.push("=== Advisory (the governor's recommendation, not enforced) ===");
    lines.push(`Recommended max parallel subagents right now: ${decision.max_concurrent}`);
    lines.push(`Reason: ${decision.reason}`);
    lines.push(`Hard sanity ceiling: ${sanity_ceiling} (this IS enforced — never request more than ${sanity_ceiling})`);

    lines.push("");
    lines.push("=== Recent performance on this hardware (last 60 min) ===");
    lines.push(performance.summary);
    if (performance.total_runs > 0) {
      if (performance.median_duration_ms !== null) {
        lines.push(`  Median successful duration: ${(performance.median_duration_ms / 1000).toFixed(1)}s`);
      }
      if (performance.p95_duration_ms !== null) {
        lines.push(`  p95 duration: ${(performance.p95_duration_ms / 1000).toFixed(1)}s`);
      }
      if (performance.by_batch_size.length > 0) {
        lines.push("  By batch size:");
        for (const g of performance.by_batch_size) {
          const med = g.median_duration_ms !== null ? `, median ${(g.median_duration_ms / 1000).toFixed(1)}s` : "";
          lines.push(`    - batch ${g.batch_size}: ${g.runs} runs, ${Math.round(g.success_rate * 100)}% ok${med}`);
        }
      }
      if (performance.failure_reasons.length > 0) {
        lines.push(`  Failures: ${performance.failure_reasons.map((f) => `${f.reason}=${f.count}`).join(", ")}`);
      }
    }

    lines.push("");
    lines.push("=== System snapshot ===");
    lines.push(`  RAM: ${decision.snapshot.ram.free_gb} GB free of ${decision.snapshot.ram.total_gb} GB total (${decision.snapshot.ram.used_pct}% used)`);
    if (decision.snapshot.active_model) {
      lines.push(`  Active model: ${decision.snapshot.active_model.name} (~${decision.snapshot.active_model.est_ram_gb} GB per concurrent run)`);
    } else {
      lines.push(`  Active model: (none — set one in the Model Manager)`);
    }
    lines.push(`  Active subagents: ${decision.snapshot.active_subagents}`);
    lines.push(`  Active processes total: ${decision.snapshot.active_processes_total}`);
    lines.push(`  Ollama reachable: ${decision.snapshot.ollama_likely_running ? "yes" : "no"}`);
    if (decision.user_setting !== null) {
      lines.push(`  User concurrency setting: ${decision.user_setting}`);
    }
    if (decision.warnings.length > 0) {
      lines.push("");
      lines.push("Governor warnings:");
      for (const w of decision.warnings) lines.push(`  - ${w}`);
    }

    lines.push("");
    lines.push("=== Decision guidance ===");
    lines.push("Use BOTH signals: the advisory is conservative based on current RAM; the performance");
    lines.push("history shows what's actually worked. If recent batches of N succeeded, you can use N");
    lines.push("even when the advisory is lower. Hard ceiling is the only absolute limit.");

    return {
      ok: true,
      output: lines.join("\n"),
      summary: `advisory=${decision.max_concurrent}, recent_success=${performance.total_runs > 0 ? Math.round(performance.success_rate * 100) + "%" : "no history"}, ceiling=${sanity_ceiling}`,
    };
  },
};
