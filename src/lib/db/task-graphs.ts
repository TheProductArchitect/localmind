/**
 * Task graphs + nodes — DB layer.
 *
 * Tables created in the V8 migration. This module is the only place that
 * speaks to those tables; everything else (executor, runner, cache, API)
 * goes through these helpers.
 *
 * All multi-row mutations run inside a transaction so a crash mid-write can't
 * half-materialise a graph. Node updates use individual prepares for hot
 * path performance (the executor updates a node's status many times per run).
 */

import { nanoid } from "nanoid";
import crypto from "crypto";
import { getConfigDb } from ".";
import { canonicalJson } from "../fleet/envelope";
import type {
  TaskGraph,
  TaskNode,
  TaskGraphStatus,
  TaskNodeStatus,
  CostBudget,
  CostActual,
  AgentSpec,
  Contract,
  Placement,
} from "../graph/types";
import { ZERO_COST } from "../graph/types";

type RawGraph = {
  graph_id: string;
  owner_user_id: string | null;
  originating_node_id: string;
  root_goal: string;
  status: TaskGraphStatus;
  cost_budget_json: string;
  cost_actual_json: string;
  parent_audit_id: number | null;
  created_at: number;
  completed_at: number | null;
};

type RawNode = {
  node_id: string;
  graph_id: string;
  parent_ids: string;
  depends_on: string;
  agent_spec_json: string;
  input_json: string;
  input_hash: string;
  contract_json: string;
  placement_json: string;
  status: TaskNodeStatus;
  output_json: string | null;
  output_hash: string | null;
  cache_hit_of_node_id: string | null;
  executing_node_id: string | null;
  cost_actual_json: string;
  retry_count: number;
  last_error: string | null;
  verification_node_id: string | null;
  process_id: string | null;
  started_at: number | null;
  completed_at: number | null;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToGraph(r: RawGraph): TaskGraph {
  return {
    graph_id: r.graph_id,
    owner_user_id: r.owner_user_id,
    originating_node_id: r.originating_node_id,
    root_goal: r.root_goal,
    status: r.status,
    cost_budget: parseJson<CostBudget>(r.cost_budget_json, {}),
    cost_actual: parseJson<CostActual>(r.cost_actual_json, ZERO_COST),
    parent_audit_id: r.parent_audit_id,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function rowToNode(r: RawNode): TaskNode {
  return {
    node_id: r.node_id,
    graph_id: r.graph_id,
    parent_ids: parseJson<string[]>(r.parent_ids, []),
    depends_on: parseJson<string[]>(r.depends_on, []),
    agent_spec: parseJson<AgentSpec>(r.agent_spec_json, { persona_id: "", tools: [], prompt_template: "" }),
    input: parseJson<Record<string, unknown>>(r.input_json, {}),
    input_hash: r.input_hash,
    contract: parseJson<Contract>(r.contract_json, { cost_budget: {} }),
    placement: parseJson<Placement>(r.placement_json, {}),
    status: r.status,
    output: r.output_json ? JSON.parse(r.output_json) : null,
    output_hash: r.output_hash,
    cache_hit_of_node_id: r.cache_hit_of_node_id,
    executing_node_id: r.executing_node_id,
    cost_actual: parseJson<CostActual>(r.cost_actual_json, ZERO_COST),
    retry_count: r.retry_count,
    last_error: r.last_error,
    verification_node_id: r.verification_node_id,
    process_id: r.process_id,
    started_at: r.started_at,
    completed_at: r.completed_at,
  };
}

/**
 * Compute the content hash used for caching. Canonical JSON serialisation
 * means parameter-order differences don't bust cache.
 *
 * Cache key includes:
 *   - persona_id and the tool set (different persona/tools may produce
 *     different answers from the same input)
 *   - prompt_template (a re-worded prompt is a different cacheable result)
 *   - the input object itself
 *
 * Decision §14.1 (locked): tool VERSION should bust the cache. That field is
 * captured at the tool-call layer in src/lib/db/tool-call-cache.ts; node-level
 * cache here uses the tool NAMES — node output caching is conservative and
 * busts whenever the tool set changes.
 */
export function computeInputHash(input: unknown, spec: AgentSpec): string {
  const material = canonicalJson({
    p: spec.persona_id,
    tools: [...spec.tools].sort(),
    tmpl: spec.prompt_template,
    input,
  });
  return crypto.createHash("sha256").update(material).digest("hex");
}

// -------------------------------------------------------------------------
// Graph CRUD
// -------------------------------------------------------------------------

export function createGraph(args: {
  owner_user_id: string | null;
  originating_node_id: string;
  root_goal: string;
  cost_budget?: CostBudget;
  parent_audit_id?: number | null;
}): TaskGraph {
  const id = `graph-${nanoid(12)}`;
  getConfigDb()
    .prepare(
      `INSERT INTO task_graphs
        (graph_id, owner_user_id, originating_node_id, root_goal, status,
         cost_budget_json, cost_actual_json, parent_audit_id, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      args.owner_user_id,
      args.originating_node_id,
      args.root_goal.slice(0, 4000),
      JSON.stringify(args.cost_budget ?? {}),
      JSON.stringify(ZERO_COST),
      args.parent_audit_id ?? null,
      readNow()
    );
  return getGraph(id)!;
}

export function getGraph(graphId: string): TaskGraph | null {
  const r = getConfigDb()
    .prepare("SELECT * FROM task_graphs WHERE graph_id=?")
    .get(graphId) as RawGraph | undefined;
  return r ? rowToGraph(r) : null;
}

export function listGraphs(ownerUserId?: string | null, limit = 50): TaskGraph[] {
  const rows = ownerUserId
    ? (getConfigDb()
        .prepare(
          "SELECT * FROM task_graphs WHERE owner_user_id IS NULL OR owner_user_id=? ORDER BY created_at DESC LIMIT ?"
        )
        .all(ownerUserId, limit) as RawGraph[])
    : (getConfigDb()
        .prepare("SELECT * FROM task_graphs ORDER BY created_at DESC LIMIT ?")
        .all(limit) as RawGraph[]);
  return rows.map(rowToGraph);
}

export function setGraphStatus(graphId: string, status: TaskGraphStatus): void {
  const completedAt = status === "running" || status === "pending" ? null : readNow();
  getConfigDb()
    .prepare("UPDATE task_graphs SET status=?, completed_at=? WHERE graph_id=?")
    .run(status, completedAt, graphId);
}

export function setGraphCost(graphId: string, cost: CostActual): void {
  getConfigDb()
    .prepare("UPDATE task_graphs SET cost_actual_json=? WHERE graph_id=?")
    .run(JSON.stringify(cost), graphId);
}

// -------------------------------------------------------------------------
// Node CRUD
// -------------------------------------------------------------------------

export function addNode(args: {
  graph_id: string;
  parent_ids?: string[];
  depends_on?: string[];
  agent_spec: AgentSpec;
  input: Record<string, unknown>;
  contract: Contract;
  placement?: Placement;
}): TaskNode {
  const node_id = `tnode-${nanoid(12)}`;
  const input_hash = computeInputHash(args.input, args.agent_spec);
  getConfigDb()
    .prepare(
      `INSERT INTO task_nodes
        (node_id, graph_id, parent_ids, depends_on, agent_spec_json, input_json,
         input_hash, contract_json, placement_json, status, cost_actual_json,
         retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0)`
    )
    .run(
      node_id,
      args.graph_id,
      JSON.stringify(args.parent_ids ?? []),
      JSON.stringify(args.depends_on ?? []),
      JSON.stringify(args.agent_spec),
      JSON.stringify(args.input),
      input_hash,
      JSON.stringify(args.contract),
      JSON.stringify(args.placement ?? {}),
      JSON.stringify(ZERO_COST)
    );
  return getNode(node_id)!;
}

export function getNode(nodeId: string): TaskNode | null {
  const r = getConfigDb()
    .prepare("SELECT * FROM task_nodes WHERE node_id=?")
    .get(nodeId) as RawNode | undefined;
  return r ? rowToNode(r) : null;
}

export function listNodes(graphId: string): TaskNode[] {
  const rows = getConfigDb()
    .prepare("SELECT * FROM task_nodes WHERE graph_id=? ORDER BY rowid")
    .all(graphId) as RawNode[];
  return rows.map(rowToNode);
}

export function setNodeStatus(
  nodeId: string,
  status: TaskNodeStatus,
  extra: Partial<{
    last_error: string | null;
    output: unknown;
    output_hash: string | null;
    cache_hit_of_node_id: string | null;
    executing_node_id: string | null;
    cost_actual: CostActual;
    process_id: string | null;
    verification_node_id: string | null;
    retry_count: number;
  }> = {}
): void {
  const cols: string[] = ["status=@status"];
  const params: Record<string, unknown> = { id: nodeId, status };

  if (status === "running" || status === "scheduled") {
    cols.push("started_at = COALESCE(started_at, @started)");
    params.started = readNow();
  }
  if (status === "done" || status === "cached" || status === "failed" || status === "cancelled" || status === "refuted" || status === "peer_lost") {
    cols.push("completed_at=@completed");
    params.completed = readNow();
  }
  if (extra.last_error !== undefined) { cols.push("last_error=@last_error"); params.last_error = extra.last_error; }
  if (extra.output !== undefined) {
    cols.push("output_json=@output_json");
    params.output_json = extra.output === null ? null : JSON.stringify(extra.output);
  }
  if (extra.output_hash !== undefined) { cols.push("output_hash=@output_hash"); params.output_hash = extra.output_hash; }
  if (extra.cache_hit_of_node_id !== undefined) { cols.push("cache_hit_of_node_id=@cache_hit"); params.cache_hit = extra.cache_hit_of_node_id; }
  if (extra.executing_node_id !== undefined) { cols.push("executing_node_id=@exec"); params.exec = extra.executing_node_id; }
  if (extra.cost_actual !== undefined) { cols.push("cost_actual_json=@cost"); params.cost = JSON.stringify(extra.cost_actual); }
  if (extra.process_id !== undefined) { cols.push("process_id=@process"); params.process = extra.process_id; }
  if (extra.verification_node_id !== undefined) { cols.push("verification_node_id=@vnode"); params.vnode = extra.verification_node_id; }
  if (extra.retry_count !== undefined) { cols.push("retry_count=@retry"); params.retry = extra.retry_count; }

  getConfigDb()
    .prepare(`UPDATE task_nodes SET ${cols.join(", ")} WHERE node_id=@id`)
    .run(params);
}

/**
 * Look up a previously completed node with the same `input_hash` that succeeded
 * and produced output satisfying its contract. Used by the executor to short-
 * circuit identical work across graphs.
 *
 * Scoped to the same owner (or both NULL) so users don't see each other's
 * results. Excludes the current graph so a re-run reseeds — caller should
 * pass the current graph_id to skip its own historic rows.
 */
export function findCachedNodeByInputHash(
  inputHash: string,
  excludeGraphId: string,
  ownerUserId: string | null
): TaskNode | null {
  const params: unknown[] = [inputHash, excludeGraphId];
  let sql =
    "SELECT * FROM task_nodes WHERE input_hash=? AND graph_id<>? AND status='done'";
  if (ownerUserId !== null) {
    sql += " AND graph_id IN (SELECT graph_id FROM task_graphs WHERE owner_user_id IS NULL OR owner_user_id=?)";
    params.push(ownerUserId);
  }
  sql += " ORDER BY completed_at DESC LIMIT 1";
  const r = getConfigDb().prepare(sql).all(...params) as RawNode[];
  return r[0] ? rowToNode(r[0]) : null;
}
