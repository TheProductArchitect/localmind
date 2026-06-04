/**
 * Sora orchestration self-test.
 *
 * Verifies:
 *   1. Settings.assistant_name is "Sora"
 *   2. The identity system-prompt block now mentions Sora AND the
 *      orchestration cues (pi_code, spawn_subagent, peer_knowledge)
 *   3. The spawn_subagent tool is registered + listable + has expected metadata
 *   4. The depth guard refuses spawning beyond MAX_SUBAGENT_DEPTH (=3) by
 *      stamping a fake conversation with depth=3 and confirming the tool
 *      refuses without launching a runaway loop
 */

import { NextResponse } from "next/server";
import { getSettings, createConversation } from "@/lib/db/queries";
import { listBuiltinTools, listAllTools } from "@/lib/tools";
import { spawnSubagentTool } from "@/lib/tools/subagent";
import { assembleSystemPrompt } from "@/lib/agent/assemble-system-prompt";
import { getConvDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Sora is the name
  try {
    const s = getSettings();
    results.push({
      name: "assistant_named_sora",
      ok: s.assistant_name === "Sora",
      detail: `assistant_name="${s.assistant_name}"`,
    });
  } catch (e) {
    results.push({ name: "assistant_named_sora", ok: false, detail: (e as Error).message });
  }

  // 2. Identity prompt mentions Sora + orchestration cues
  try {
    const prompt = await assembleSystemPrompt("persona-general", {});
    const hasSora = prompt.assembled.includes("Sora");
    const hasPi = prompt.assembled.includes("pi_code");
    const hasSpawn = prompt.assembled.includes("spawn_subagent");
    const hasPeer = prompt.assembled.includes("peer_knowledge");
    results.push({
      name: "identity_prompt_has_orchestration_cues",
      ok: hasSora && hasPi && hasSpawn && hasPeer,
      detail: `sora=${hasSora} pi=${hasPi} spawn=${hasSpawn} peer=${hasPeer} (token_estimate=${prompt.tokenEstimate})`,
    });
  } catch (e) {
    results.push({ name: "identity_prompt_has_orchestration_cues", ok: false, detail: (e as Error).message });
  }

  // 3. Tool registry includes spawn_subagent + pi_code + peer_knowledge
  try {
    const builtins = listBuiltinTools();
    const all = await listAllTools();
    const builtinNames = new Set(builtins.map((t) => t.definition.name));
    const allNames = new Set(all.map((t) => t.definition.name));
    const needed = ["spawn_subagent", "pi_code", "peer_knowledge"];
    const missing = needed.filter((n) => !builtinNames.has(n));
    results.push({
      name: "orchestration_tools_registered",
      ok: missing.length === 0,
      detail: `builtins=${builtinNames.size} all=${allNames.size} missing=[${missing.join(",")}]`,
    });
    // Confirm spawn_subagent's parameters are well-formed
    const params = spawnSubagentTool.definition.parameters as { properties: Record<string, unknown>; required?: string[] };
    const hasGoal = !!params.properties.goal;
    const goalRequired = (params.required || []).includes("goal");
    results.push({
      name: "spawn_subagent_schema_valid",
      ok: hasGoal && goalRequired,
      detail: `goal_param=${hasGoal} goal_required=${goalRequired}`,
    });
  } catch (e) {
    results.push({ name: "orchestration_tools_registered", ok: false, detail: (e as Error).message });
  }

  // 4. Depth guard — stamp a fake parent conversation at MAX depth and confirm
  // the tool refuses without actually running an agent.
  try {
    const conv = createConversation();
    // Stamp depth=3 directly (same path the tool uses internally).
    getConvDb()
      .prepare("UPDATE conversations SET tags=? WHERE id=?")
      .run(JSON.stringify(["subagent_depth:3"]), conv.id);

    const result = await spawnSubagentTool.execute(
      { goal: "depth-cap test — should never run" },
      { conversationId: conv.id, approvedDirs: [] }
    );
    const refusedAtCap = !result.ok && /already at subagent depth 3/.test(result.output);
    results.push({
      name: "depth_cap_refuses_at_max",
      ok: refusedAtCap,
      detail: `ok=${result.ok} output="${result.output.slice(0, 140)}"`,
    });

    // Cleanup the test conversation row.
    getConvDb().prepare("UPDATE conversations SET deleted_at=? WHERE id=?").run(Date.now(), conv.id);
  } catch (e) {
    results.push({ name: "depth_cap_refuses_at_max", ok: false, detail: (e as Error).message });
  }

  return NextResponse.json({
    all_ok: results.every((r) => r.ok),
    results,
  });
}
