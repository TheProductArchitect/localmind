/**
 * Task graph types — the V6 unit of work.
 *
 * Every agent invocation in V6 compiles to a TaskGraph. A graph is a DAG of
 * typed nodes; each node has explicit inputs, an agent spec (persona + tools +
 * model hint), and a contract that defines success. Outputs are content-
 * addressed by `input_hash` so re-running an identical node hits the cache.
 *
 * Single-machine execution lives in src/lib/graph/executor.ts. Peer placement
 * (V6.5) reuses these types unchanged — placement is a runner concern, not a
 * graph concern.
 */

export type TaskGraphStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "halted_budget";

export type TaskNodeStatus =
  | "pending"        // depends_on not yet satisfied
  | "scheduled"      // ready to run, awaiting an executor slot
  | "running"        // executor is mid-call
  | "done"           // succeeded, output_json populated
  | "cached"         // satisfied from cache, output copied from cache_hit_of_node_id
  | "failed"         // ran, threw or violated contract; last_error populated
  | "cancelled"
  | "refuted"        // verifier rejected — last_error has the refute reason
  | "peer_lost";     // V6.5: peer running this node went silent

export type RetryPolicy = "retryable" | "poisonable" | "partial-acceptable";

/** Persona + tools + model preference for a single node's work. */
export type AgentSpec = {
  persona_id: string;             // foreign key to personas table
  tools: string[];                // tool names the node is allowed to use
  model_preference?: string;      // override active_model; lands in V6.5 multi-model
  prompt_template: string;        // template with {input.X} substitutions
  requires_verification?: boolean;// spawn a refute sibling after this node completes
  requires_pin?: boolean;         // V6.4: gate write actions behind PIN even if profile is allow
  retry_policy?: RetryPolicy;     // default 'retryable'
  max_iterations?: number;        // cap on agent turns inside this node (default 8)
};

/**
 * Per-node contract. The executor enforces these.
 *
 *   - success_predicate: a natural-language description ("the output is a JSON
 *     array of at least 5 objects, each with a `name` and `url` field"). Used
 *     by the refute pass — never auto-parsed.
 *   - output_schema: optional JSON schema for output validation. If present,
 *     the executor parses the output as JSON and validates structurally.
 *   - cost_budget: per-node bound. The executor refuses to schedule a node
 *     when the graph's remaining budget is below the node's allocation.
 */
export type Contract = {
  input_schema?: object;
  output_schema?: object;
  success_predicate?: string;
  cost_budget: {
    tokens?: number;
    wall_seconds?: number;
  };
};

/** Placement hints — single-machine in V6.3, peer-aware in V6.5. */
export type Placement = {
  preferred_node_id?: string;     // peer fingerprint, optional
  required_tools?: string[];
  required_model_class?: "large" | "fast" | "tool-calling";
};

/** Graph-level cost budget; per-node budgets in Contract are checked against this. */
export type CostBudget = {
  tokens?: number;
  wall_seconds?: number;
  usd?: number;
};

export type CostActual = {
  tokens: number;
  wall_seconds: number;
  usd: number;
};

export const ZERO_COST: CostActual = { tokens: 0, wall_seconds: 0, usd: 0 };

export type TaskGraph = {
  graph_id: string;
  owner_user_id: string | null;
  originating_node_id: string;    // fleet node_id where graph lives
  root_goal: string;
  status: TaskGraphStatus;
  cost_budget: CostBudget;
  cost_actual: CostActual;
  parent_audit_id: number | null;
  created_at: number;
  completed_at: number | null;
};

export type TaskNode = {
  node_id: string;
  graph_id: string;
  parent_ids: string[];
  depends_on: string[];
  agent_spec: AgentSpec;
  input: Record<string, unknown>;
  input_hash: string;
  contract: Contract;
  placement: Placement;
  status: TaskNodeStatus;
  output: unknown | null;
  output_hash: string | null;
  cache_hit_of_node_id: string | null;
  executing_node_id: string | null;
  cost_actual: CostActual;
  retry_count: number;
  last_error: string | null;
  verification_node_id: string | null;
  process_id: string | null;
  started_at: number | null;
  completed_at: number | null;
};

/** What the runner returns after executing a node. */
export type NodeRunResult = {
  ok: boolean;
  output: unknown;
  output_text?: string;           // raw text — used by refute pass for human-readable checks
  cost: CostActual;
  error?: string;
  partial?: boolean;              // partial-acceptable result
};

/** Injectable node-runner — local agent in V6.3, peer-RPC in V6.5. */
export type NodeRunner = (node: TaskNode, ctx: RunnerContext) => Promise<NodeRunResult>;

export type RunnerContext = {
  graph: TaskGraph;
  parent_outputs: Record<string, unknown>;
  conversation_id?: string;       // graph-scoped conversation if the runner needs one
  signal?: AbortSignal;
};

/** Result of one executor pass over a graph. */
export type ExecutorOutcome = {
  graph_id: string;
  final_status: TaskGraphStatus;
  total_cost: CostActual;
  refuted_nodes: string[];
  failed_nodes: string[];
  cached_nodes: string[];
  ran_nodes: string[];
};
