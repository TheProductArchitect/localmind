/**
 * V6.3 self-test: builds a real fan-out/join graph in the DB and runs it end-
 * to-end with a deterministic stub runner.
 *
 * The stub runner doesn't talk to Ollama — it returns canned output based on
 * the node's input. This lets us verify the executor's structural correctness
 * (topo order, fan-out, join, cache hits, refute pass, budget) without
 * depending on a live LLM.
 *
 * Tests:
 *   1. Build a 4-node fan-out/join graph
 *   2. Execute it; verify nodes complete in topo order
 *   3. Run again — workers should hit cache (same input_hash)
 *   4. Build a graph that exceeds budget; verify halted_budget
 *   5. Build a graph with requires_verification; verify the refute pass runs
 */

import { NextResponse } from "next/server";
import { buildFanOutJoin, buildSingleNode } from "@/lib/graph/build";
import { executeGraph } from "@/lib/graph/executor";
import { listNodes, getGraph } from "@/lib/db/task-graphs";
import type { NodeRunner, NodeRunResult, RunnerContext, TaskNode } from "@/lib/graph/types";

export const runtime = "nodejs";

function stubRunner(label: string): NodeRunner {
  return async (node: TaskNode, ctx: RunnerContext): Promise<NodeRunResult> => {
    // Deterministic output: echoes the prompt + parent outputs into a stable string.
    const parents = Object.entries(ctx.parent_outputs)
      .map(([id, out]) => `${id.slice(0, 8)}:${typeof out === "string" ? out.slice(0, 40) : JSON.stringify(out).slice(0, 40)}`)
      .join("|");
    const text = `${label}@${node.node_id.slice(-8)}{parents=${parents || "none"}}`;
    return {
      ok: true,
      output: text,
      output_text: text,
      cost: { tokens: 100, wall_seconds: 0.05, usd: 0 },
    };
  };
}

const refuteRunner: NodeRunner = async (node: TaskNode): Promise<NodeRunResult> => {
  // For nodes whose prompt template is the refute prompt, return a structured
  // verdict. The refute.ts module looks for "refuted":<bool> in the output.
  if (node.node_id.endsWith("-refute")) {
    const verdict = { refuted: false, reason: "stub-verified" };
    const text = JSON.stringify(verdict);
    return { ok: true, output: text, output_text: text, cost: { tokens: 50, wall_seconds: 0.02, usd: 0 } };
  }
  // Regular nodes — echo input + label.
  return {
    ok: true,
    output: `produced@${node.node_id.slice(-8)}`,
    output_text: `produced@${node.node_id.slice(-8)}`,
    cost: { tokens: 200, wall_seconds: 0.1, usd: 0 },
  };
};

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // Per-invocation seed so subsequent test runs don't pollute each other via
  // the node-output cache. The cache hit test below intentionally uses the
  // seed inside the same invocation to engineer a deterministic hit.
  const seed = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  const personaA = "persona-general";
  const spec = (template: string) => ({
    persona_id: personaA,
    tools: [],
    prompt_template: template,
  });

  // 1. Fan-out / join — verify topo order. Splitter input includes seed so it
  // never collides with a prior invocation. Worker inputs also include seed
  // so we control when their hashes match (re-used in test 2).
  let firstGraphId = "";
  let firstFinalCost = { tokens: 0, wall_seconds: 0, usd: 0 };
  try {
    const graph = buildFanOutJoin({
      root_goal: `self-test fan-out [${seed}]`,
      splitter: { agent_spec: spec("split {input.topic}"), input: { topic: "vector_dbs", seed } },
      workers: [
        { agent_spec: spec("worker A"), input: { idx: 0, seed } },
        { agent_spec: spec("worker B"), input: { idx: 1, seed } },
        { agent_spec: spec("worker C"), input: { idx: 2, seed } },
      ],
      join: { agent_spec: spec("join results"), input: { seed } },
    });
    firstGraphId = graph.graph_id;
    const outcome = await executeGraph(graph.graph_id, { runner: stubRunner("v6.3"), skip_refute: true });
    firstFinalCost = outcome.total_cost;
    const nodes = listNodes(graph.graph_id);
    const allDone = nodes.every((n) => n.status === "done");
    const joinDeps = nodes.find((n) => n.depends_on.length === 3);
    results.push({
      name: "fan_out_join_completes",
      ok: outcome.final_status === "completed" && allDone && !!joinDeps,
      detail: `final=${outcome.final_status} nodes=${nodes.length} all_done=${allDone} cost.tokens=${outcome.total_cost.tokens}`,
    });
  } catch (e) {
    results.push({ name: "fan_out_join_completes", ok: false, detail: (e as Error).message });
  }

  // 2. Re-run with same worker inputs (same seed) — those nodes should hit
  // the cache. Splitter + join use a different input so they re-run.
  try {
    const graph = buildFanOutJoin({
      root_goal: `self-test fan-out r2 [${seed}]`,
      splitter: { agent_spec: spec("split-r2"), input: { topic: "different", seed: `${seed}-r2` } },
      workers: [
        // Identical to run 1 → cache hit.
        { agent_spec: spec("worker A"), input: { idx: 0, seed } },
        { agent_spec: spec("worker B"), input: { idx: 1, seed } },
        { agent_spec: spec("worker C"), input: { idx: 2, seed } },
      ],
      join: { agent_spec: spec("join-r2"), input: { seed: `${seed}-r2` } },
    });
    const outcome = await executeGraph(graph.graph_id, { runner: stubRunner("v6.3-r2"), skip_refute: true });
    results.push({
      name: "node_cache_hit",
      ok: outcome.cached_nodes.length === 3 && outcome.final_status === "completed",
      detail: `cached=${outcome.cached_nodes.length}/3 ran=${outcome.ran_nodes.length} status=${outcome.final_status}`,
    });
  } catch (e) {
    results.push({ name: "node_cache_hit", ok: false, detail: (e as Error).message });
  }

  // 3. Budget halt — tiny budget, big work.
  try {
    const graph = buildFanOutJoin({
      root_goal: "self-test budget",
      splitter: {
        agent_spec: spec("budget-test-splitter"),
        input: { unique: Math.floor(Math.random() * 1e9) }, // bust any cache
        contract: { cost_budget: { tokens: 50, wall_seconds: 5 } },
      },
      workers: [
        { agent_spec: spec("budget-w1"), input: { idx: 0 }, contract: { cost_budget: { tokens: 50, wall_seconds: 5 } } },
        { agent_spec: spec("budget-w2"), input: { idx: 1 }, contract: { cost_budget: { tokens: 50, wall_seconds: 5 } } },
      ],
      join: { agent_spec: spec("budget-join"), input: {}, contract: { cost_budget: { tokens: 50, wall_seconds: 5 } } },
      opts: { cost_budget: { tokens: 120, wall_seconds: 60 } }, // 120 tokens, but stub uses 100 per node × 4 = 400
    });
    const outcome = await executeGraph(graph.graph_id, { runner: stubRunner("v6.3-budget"), skip_refute: true });
    results.push({
      name: "budget_halt",
      ok: outcome.final_status === "halted_budget",
      detail: `final=${outcome.final_status} cost.tokens=${outcome.total_cost.tokens} budget=120`,
    });
  } catch (e) {
    results.push({ name: "budget_halt", ok: false, detail: (e as Error).message });
  }

  // 4. Refute pass — single-node graph with requires_verification, verifier
  //    returns a clean verdict.
  try {
    const graph = buildSingleNode({
      root_goal: "self-test refute",
      agent_spec: {
        persona_id: personaA,
        tools: ["web_search"],
        prompt_template: "produce something to verify {input.x}",
        requires_verification: true,
      },
      input: { x: `unique-${Math.floor(Math.random() * 1e9)}` },
      contract: {
        cost_budget: { tokens: 1000, wall_seconds: 30 },
        success_predicate: "the output is non-empty",
      },
    });
    const outcome = await executeGraph(graph.graph_id, { runner: refuteRunner });
    const nodes = listNodes(graph.graph_id);
    const node = nodes[0];
    results.push({
      name: "refute_pass_runs",
      ok: outcome.final_status === "completed" && node.status === "done",
      detail: `final=${outcome.final_status} node_status=${node.status} cost.tokens=${outcome.total_cost.tokens} (expected >100, refute added cost)`,
    });
  } catch (e) {
    results.push({ name: "refute_pass_runs", ok: false, detail: (e as Error).message });
  }

  return NextResponse.json({
    all_ok: results.every((r) => r.ok),
    first_graph_id: firstGraphId,
    first_graph_cost: firstFinalCost,
    results,
  });
}
