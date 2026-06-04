/**
 * Self-test for the resource governor + parallel-batch primitive.
 *
 *   1. snapshotResources returns sane RAM + active-process numbers
 *   2. decideCapacity floors requested_max by RAM / model / current load
 *      and never returns 0
 *   3. check_resources tool renders a useful digest including max_concurrent
 *   4. bounded() concurrency wrapper actually limits in-flight executions
 *      (timed with stub async functions that record peak concurrency)
 *   5. spawn_subagents_parallel validates input (empty batch, oversize batch,
 *      missing goal) without dropping into the real agent loop
 *   6. The new identity-prompt block mentions check_resources +
 *      spawn_subagents_parallel + the dependency-map step
 */

import { NextResponse } from "next/server";
import { decideCapacity, snapshotResources } from "@/lib/agent/resource-governor";
import { checkResourcesTool } from "@/lib/tools/check-resources";
import { spawnSubagentsParallelTool, __test_internals } from "@/lib/tools/subagent";
import { assembleSystemPrompt } from "@/lib/agent/assemble-system-prompt";
import { createConversation } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. snapshot has numbers we expect
  try {
    const snap = await snapshotResources();
    const ok =
      typeof snap.ram.total_gb === "number" && snap.ram.total_gb > 0 &&
      typeof snap.ram.free_gb === "number" && snap.ram.free_gb >= 0 &&
      typeof snap.active_subagents === "number" &&
      typeof snap.ollama_likely_running === "boolean";
    results.push({
      name: "snapshot_resources",
      ok,
      detail: `total=${snap.ram.total_gb}GB free=${snap.ram.free_gb}GB used=${snap.ram.used_pct}% subagents=${snap.active_subagents} ollama=${snap.ollama_likely_running} model=${snap.active_model?.name ?? "(none)"}`,
    });
  } catch (e) {
    results.push({ name: "snapshot_resources", ok: false, detail: (e as Error).message });
  }

  // 2. decideCapacity respects requested cap and never returns 0
  try {
    const d1 = await decideCapacity(8);
    const d2 = await decideCapacity(1);
    const d3 = await decideCapacity(100); // overlarge request — should be floored
    const okBounds =
      d1.max_concurrent >= 1 && d1.max_concurrent <= 8 &&
      d2.max_concurrent === 1 &&
      d3.max_concurrent >= 1 && d3.max_concurrent <= 100;
    results.push({
      name: "decide_capacity_floor_and_never_zero",
      ok: okBounds,
      detail: `req(8)=${d1.max_concurrent} req(1)=${d2.max_concurrent} req(100)=${d3.max_concurrent} reason1="${d1.reason}"`,
    });
  } catch (e) {
    results.push({ name: "decide_capacity_floor_and_never_zero", ok: false, detail: (e as Error).message });
  }

  // 3. check_resources tool renders useful output
  try {
    const r = await checkResourcesTool.execute({ requested_max: 4 }, { conversationId: "test", approvedDirs: [] });
    const hasCap = r.output.includes("max parallel subagents");
    const hasRam = r.output.includes("RAM:");
    const hasModel = r.output.includes("Active model:");
    results.push({
      name: "check_resources_tool_output",
      ok: r.ok && hasCap && hasRam && hasModel,
      detail: `summary="${r.summary ?? ""}" lines=${(r.output.match(/\n/g) ?? []).length + 1}`,
    });
  } catch (e) {
    results.push({ name: "check_resources_tool_output", ok: false, detail: (e as Error).message });
  }

  // 4. bounded() respects concurrency limit (using stubs that record peak)
  try {
    let inFlight = 0;
    let peak = 0;
    const N = 12;
    const LIMIT = 3;
    const runners = Array.from({ length: N }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
      return "ok";
    });
    const t0 = Date.now();
    const out = await __test_internals.bounded(runners, LIMIT);
    const elapsed = Date.now() - t0;
    const ok = peak === LIMIT && out.length === N && out.every((x) => x === "ok");
    results.push({
      name: "bounded_concurrency_respects_limit",
      ok,
      detail: `N=${N} limit=${LIMIT} peak=${peak} elapsed=${elapsed}ms (expect ~${Math.ceil(N / LIMIT) * 40}ms)`,
    });
  } catch (e) {
    results.push({ name: "bounded_concurrency_respects_limit", ok: false, detail: (e as Error).message });
  }

  // 5. spawn_subagents_parallel rejects bad input cleanly
  try {
    const conv = createConversation();
    const empty = await spawnSubagentsParallelTool.execute({ batch: [] }, { conversationId: conv.id, approvedDirs: [] });
    const oversize = await spawnSubagentsParallelTool.execute(
      { batch: Array.from({ length: 20 }, (_, i) => ({ goal: `g${i}` })) },
      { conversationId: conv.id, approvedDirs: [] }
    );
    const missingGoal = await spawnSubagentsParallelTool.execute(
      { batch: [{ goal: "" }] },
      { conversationId: conv.id, approvedDirs: [] }
    );
    const okValidation = !empty.ok && !oversize.ok && !missingGoal.ok &&
      empty.output.includes("at least one") &&
      oversize.output.includes("exceeds the maximum") &&
      missingGoal.output.includes("required");
    results.push({
      name: "parallel_spawn_validates_input",
      ok: okValidation,
      detail: `empty="${empty.output.slice(0, 60)}" oversize="${oversize.output.slice(0, 60)}" missing="${missingGoal.output.slice(0, 60)}"`,
    });
  } catch (e) {
    results.push({ name: "parallel_spawn_validates_input", ok: false, detail: (e as Error).message });
  }

  // 6. Identity prompt references new orchestration cues
  try {
    const prompt = await assembleSystemPrompt("persona-general", {});
    const hasCheckResources = prompt.assembled.includes("check_resources");
    const hasParallel = prompt.assembled.includes("spawn_subagents_parallel");
    const hasDependencyStep = prompt.assembled.includes("DEPENDENCY MAP");
    const hasEfficiency = prompt.assembled.includes("EFFICIENCY RULE");
    results.push({
      name: "identity_prompt_has_decision_protocol",
      ok: hasCheckResources && hasParallel && hasDependencyStep && hasEfficiency,
      detail: `check_resources=${hasCheckResources} parallel=${hasParallel} dep_map=${hasDependencyStep} eff_rule=${hasEfficiency} (tokens=${prompt.tokenEstimate})`,
    });
  } catch (e) {
    results.push({ name: "identity_prompt_has_decision_protocol", ok: false, detail: (e as Error).message });
  }

  return NextResponse.json({
    all_ok: results.every((r) => r.ok),
    results,
  });
}
