/**
 * Task graph executor.
 *
 * Algorithm:
 *   while (graph has pending nodes AND budget allows):
 *     find candidates: pending nodes whose depends_on are all done/cached
 *     if no candidates and nothing running: break (done or deadlocked)
 *     for each candidate up to concurrency cap:
 *       attempt cache lookup; on hit, mark cached and copy output
 *       on miss, schedule for execution via the pluggable runner
 *     await any in-flight node to complete; record cost, advance status
 *     if node completed with requires_verification → spawn refute pass
 *
 * Failure semantics per V6 plan §8:
 *   retryable        — exponential backoff, max 3 attempts
 *   poisonable       — surfaced immediately, downstream skipped
 *   partial-acceptable — output flagged, downstream sees the partial flag
 *
 * Cost budgeting: graph-level budget is decremented after every node. Before
 * scheduling a new candidate we check that the contract's allocation fits
 * within remaining budget; if not the graph transitions to `halted_budget`
 * and the user can resume after extending the budget.
 *
 * V6.3 ships single-machine. The runner is injectable so V6.5 swaps in a
 * peer-RPC variant without changing this file.
 */

import {
  getGraph,
  getNode,
  listNodes,
  setGraphCost,
  setGraphStatus,
  setNodeStatus,
} from "../db/task-graphs";
import { startProcess, completeProcess } from "../db/agent-processes";
import { unregisterProcess } from "../agent/process-registry";
import { lookupNodeCache } from "./cache";
import { runRefute } from "./refute";
import type {
  ExecutorOutcome,
  NodeRunResult,
  NodeRunner,
  RunnerContext,
  TaskGraph,
  TaskNode,
  CostActual,
} from "./types";
import { ZERO_COST } from "./types";

export type ExecuteOptions = {
  runner: NodeRunner;
  concurrency?: number;                 // default 2
  signal?: AbortSignal;
  /** Suppress refute pass — useful for tests that want pure execution timing. */
  skip_refute?: boolean;
};

function sumCost(a: CostActual, b: CostActual): CostActual {
  return {
    tokens: a.tokens + b.tokens,
    wall_seconds: a.wall_seconds + b.wall_seconds,
    usd: a.usd + b.usd,
  };
}

function remainingBudget(graph: TaskGraph): { tokens: number; wall_seconds: number } {
  return {
    tokens: graph.cost_budget.tokens === undefined ? Infinity : Math.max(0, graph.cost_budget.tokens - graph.cost_actual.tokens),
    wall_seconds:
      graph.cost_budget.wall_seconds === undefined
        ? Infinity
        : Math.max(0, graph.cost_budget.wall_seconds - graph.cost_actual.wall_seconds),
  };
}

function fits(remaining: { tokens: number; wall_seconds: number }, contract: TaskNode["contract"]): boolean {
  const t = contract.cost_budget.tokens ?? 0;
  const w = contract.cost_budget.wall_seconds ?? 0;
  return remaining.tokens >= t && remaining.wall_seconds >= w;
}

function isTerminal(n: TaskNode): boolean {
  return n.status === "done" || n.status === "cached" || n.status === "failed" || n.status === "cancelled" || n.status === "refuted";
}

function isFinishedNonError(n: TaskNode): boolean {
  return n.status === "done" || n.status === "cached";
}

/**
 * Read all nodes for a graph and reload it fresh from DB. The executor calls
 * this on every loop iteration so external state changes (cancel, inject) are
 * visible. Cheap: SQLite + indices.
 */
function snapshot(graphId: string): { graph: TaskGraph; nodes: TaskNode[] } | null {
  const graph = getGraph(graphId);
  if (!graph) return null;
  const nodes = listNodes(graphId);
  return { graph, nodes };
}

export async function executeGraph(graphId: string, opts: ExecuteOptions): Promise<ExecutorOutcome> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const cancelSignal = opts.signal;

  const initial = snapshot(graphId);
  if (!initial) throw new Error(`Graph not found: ${graphId}`);

  setGraphStatus(graphId, "running");
  const processId = startProcessForGraph(initial.graph);

  // Per-graph runner context — caches the conversation_id across nodes.
  const ctx: RunnerContext = {
    graph: initial.graph,
    parent_outputs: {},
    signal: cancelSignal,
  };

  const outcome: ExecutorOutcome = {
    graph_id: graphId,
    final_status: "running",
    total_cost: { ...ZERO_COST },
    refuted_nodes: [],
    failed_nodes: [],
    cached_nodes: [],
    ran_nodes: [],
  };

  type InFlight = { node_id: string; promise: Promise<NodeRunResult> };
  const inFlight = new Map<string, InFlight>();

  try {
    // Main loop.
    while (true) {
      if (cancelSignal?.aborted) {
        setGraphStatus(graphId, "cancelled");
        outcome.final_status = "cancelled";
        break;
      }

      const cur = snapshot(graphId);
      if (!cur) break;
      const { graph, nodes } = cur;

      // Refresh ctx.graph + parent_outputs from current snapshot.
      ctx.graph = graph;
      ctx.parent_outputs = Object.fromEntries(
        nodes.filter(isFinishedNonError).map((n) => [n.node_id, n.output])
      );

      const allTerminalNonError = nodes.every(isFinishedNonError);
      if (allTerminalNonError && inFlight.size === 0) {
        setGraphStatus(graphId, "completed");
        outcome.final_status = "completed";
        break;
      }

      const anyFailed = nodes.some((n) => n.status === "failed" || n.status === "refuted");
      const allTerminal = nodes.every(isTerminal);
      if (allTerminal && inFlight.size === 0) {
        const finalStatus = anyFailed ? "failed" : "completed";
        setGraphStatus(graphId, finalStatus);
        outcome.final_status = finalStatus;
        break;
      }

      // Find candidates: pending nodes whose deps are all in {done, cached}.
      const candidates = nodes.filter((n) => {
        if (n.status !== "pending") return false;
        return n.depends_on.every((depId) => {
          const dep = nodes.find((d) => d.node_id === depId);
          return dep && isFinishedNonError(dep);
        });
      });

      // Schedule cache hits eagerly — those are zero-cost.
      let scheduledThisTick = 0;
      let halted = false;
      const remaining = remainingBudget(graph);
      for (const cand of candidates) {
        if (inFlight.size + scheduledThisTick >= concurrency) break;

        // Cache check.
        const cache = lookupNodeCache(cand, graph.owner_user_id);
        if (cache.hit) {
          setNodeStatus(cand.node_id, "cached", {
            output: cache.output,
            output_hash: cache.output_hash,
            cache_hit_of_node_id: cache.source_node_id,
            cost_actual: ZERO_COST,
          });
          outcome.cached_nodes.push(cand.node_id);
          continue;
        }

        // Budget check. Halt the graph but leave the unscheduled candidates
        // in `pending` — caller can resume after extending the budget and
        // the executor picks up where it stopped. Marking them `failed` here
        // would lose resume semantics, and letting the loop continue would
        // let the post-loop "all terminal → failed" branch overwrite
        // halted_budget with failed.
        if (!fits(remaining, cand.contract)) {
          halted = true;
          break;
        }

        // Spawn the runner for this candidate.
        const childProc = startProcess({
          process_type: "long_running_job",
          display_name: `node:${cand.node_id.slice(0, 12)}`,
          owner_user_id: graph.owner_user_id,
          agent_name: "Node runner",
          metadata: { graph_id: graphId, node_id: cand.node_id, kind: "task_node" },
        });
        setNodeStatus(cand.node_id, "running", {
          executing_node_id: graph.originating_node_id,
          process_id: childProc,
        });
        scheduledThisTick++;

        const nodeForRun = getNode(cand.node_id)!;
        const p = opts.runner(nodeForRun, ctx).finally(() => {
          completeProcess(childProc, "completed");
          unregisterProcess(childProc);
        });
        inFlight.set(cand.node_id, { node_id: cand.node_id, promise: p });
      }

      if (halted) {
        // Drain anything already in flight before stopping so we don't leave
        // dangling promises pointing at stale node state. Their cost still
        // counts against the graph.
        if (inFlight.size > 0) {
          const all = await Promise.allSettled([...inFlight.values()].map((f) => f.promise));
          inFlight.clear();
          // Roll cost from drained results into the graph.
          for (const r of all) {
            if (r.status === "fulfilled") {
              setGraphCost(graphId, sumCost(snapshot(graphId)!.graph.cost_actual, r.value.cost));
              outcome.total_cost = sumCost(outcome.total_cost, r.value.cost);
            }
          }
        }
        setGraphStatus(graphId, "halted_budget");
        outcome.final_status = "halted_budget";
        break;
      }

      if (inFlight.size === 0 && candidates.length === 0) {
        // Nothing ran, nothing pending — likely deadlocked deps. Mark graph
        // failed and exit.
        const finalStatus = nodes.every(isFinishedNonError) ? "completed" : "failed";
        setGraphStatus(graphId, finalStatus);
        outcome.final_status = finalStatus;
        break;
      }

      if (inFlight.size === 0) continue;  // pending but no candidates eligible — shouldn't happen often, loop again

      // Wait for any in-flight node to complete.
      const settled = await Promise.race(
        [...inFlight.values()].map((f) => f.promise.then((r) => ({ node_id: f.node_id, r })))
      );
      inFlight.delete(settled.node_id);

      const result = settled.r;
      const completedNode = getNode(settled.node_id);
      if (!completedNode) continue;

      // Roll cost up to graph.
      const newGraphCost = sumCost(graph.cost_actual, result.cost);
      setGraphCost(graphId, newGraphCost);
      outcome.total_cost = sumCost(outcome.total_cost, result.cost);

      if (!result.ok) {
        const policy = completedNode.agent_spec.retry_policy ?? "retryable";
        const canRetry = policy === "retryable" && completedNode.retry_count < 3;
        if (canRetry) {
          // Bump retry, leave node pending again. The next loop iteration
          // will pick it up. Status moves back to pending; the executor
          // doesn't apply backoff inline so the loop stays responsive — a
          // future refinement is per-node setTimeout.
          setNodeStatus(settled.node_id, "pending", {
            retry_count: completedNode.retry_count + 1,
            last_error: result.error ?? "unknown error",
            cost_actual: sumCost(completedNode.cost_actual, result.cost),
          });
        } else {
          setNodeStatus(settled.node_id, "failed", {
            last_error: result.error ?? "unknown error",
            cost_actual: sumCost(completedNode.cost_actual, result.cost),
          });
          outcome.failed_nodes.push(settled.node_id);
        }
        continue;
      }

      // Success path.
      setNodeStatus(settled.node_id, "done", {
        output: result.output,
        cost_actual: sumCost(completedNode.cost_actual, result.cost),
      });

      // Refute pass.
      if (completedNode.agent_spec.requires_verification && !opts.skip_refute) {
        const refuted = await runRefute(completedNode, result.output, opts.runner, ctx);
        // Add refute cost to graph cost too.
        setGraphCost(graphId, sumCost(snapshot(graphId)!.graph.cost_actual, refuted.cost));
        outcome.total_cost = sumCost(outcome.total_cost, refuted.cost);
        if (refuted.refuted) {
          setNodeStatus(settled.node_id, "refuted", { last_error: refuted.reason });
          outcome.refuted_nodes.push(settled.node_id);
        } else {
          // Stays "done" — keep that status. We're just recording that
          // verification happened (no schema field for verifier verdicts in
          // V6.3; V6.4 promotes this to a structured column).
        }
      } else {
        outcome.ran_nodes.push(settled.node_id);
      }
    }
  } finally {
    completeProcess(processId, outcome.final_status === "completed" ? "completed" : outcome.final_status === "cancelled" ? "cancelled" : "failed");
    unregisterProcess(processId);
  }

  return outcome;
}

function startProcessForGraph(graph: TaskGraph): string {
  return startProcess({
    process_type: "long_running_job",
    display_name: graph.root_goal.slice(0, 80),
    owner_user_id: graph.owner_user_id,
    agent_name: "Graph executor",
    metadata: { graph_id: graph.graph_id, kind: "task_graph" },
  });
}
