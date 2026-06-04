/**
 * Smoke test for the V6.9 governor changes:
 *   - check_resources output now includes BOTH the advisory and recent
 *     performance signals
 *   - SANITY_CEILING constant is exposed and is 16
 *   - recentSubagentPerformance handles the empty-history case cleanly
 */

import { NextResponse } from "next/server";
import { checkResourcesTool } from "@/lib/tools/check-resources";
import { advisoryAndHistory, recentSubagentPerformance, SANITY_CEILING } from "@/lib/agent/resource-governor";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. sanity ceiling
  results.push({
    name: "sanity_ceiling_is_16",
    ok: SANITY_CEILING === 16,
    detail: `SANITY_CEILING=${SANITY_CEILING}`,
  });

  // 2. recentSubagentPerformance returns a valid empty-history shape
  try {
    const perf = recentSubagentPerformance(60);
    const ok =
      typeof perf.total_runs === "number" &&
      Array.isArray(perf.by_batch_size) &&
      typeof perf.summary === "string" &&
      perf.summary.length > 0;
    results.push({
      name: "perf_rollup_empty_history",
      ok,
      detail: `total_runs=${perf.total_runs} summary="${perf.summary.slice(0, 80)}"`,
    });
  } catch (e) {
    results.push({ name: "perf_rollup_empty_history", ok: false, detail: (e as Error).message });
  }

  // 3. advisoryAndHistory combines both signals
  try {
    const r = await advisoryAndHistory(4);
    const ok =
      r.decision.max_concurrent >= 1 &&
      typeof r.performance.total_runs === "number" &&
      r.sanity_ceiling === 16;
    results.push({
      name: "advisory_and_history_combines",
      ok,
      detail: `advisory=${r.decision.max_concurrent} (${r.decision.reason}); history_runs=${r.performance.total_runs}; ceiling=${r.sanity_ceiling}`,
    });
  } catch (e) {
    results.push({ name: "advisory_and_history_combines", ok: false, detail: (e as Error).message });
  }

  // 4. check_resources tool surfaces both signals in human-readable form
  try {
    const r = await checkResourcesTool.execute({ requested_max: 6 }, { conversationId: "test", approvedDirs: [] });
    const hasAdvisory = r.output.includes("Advisory");
    const hasHistory = r.output.includes("Recent performance");
    const hasCeiling = r.output.includes("sanity ceiling");
    const hasGuidance = r.output.includes("Decision guidance");
    results.push({
      name: "check_resources_renders_both_signals",
      ok: r.ok && hasAdvisory && hasHistory && hasCeiling && hasGuidance,
      detail: `advisory=${hasAdvisory} history=${hasHistory} ceiling=${hasCeiling} guidance=${hasGuidance}`,
    });
  } catch (e) {
    results.push({ name: "check_resources_renders_both_signals", ok: false, detail: (e as Error).message });
  }

  return NextResponse.json({
    all_ok: results.every((r) => r.ok),
    results,
  });
}
