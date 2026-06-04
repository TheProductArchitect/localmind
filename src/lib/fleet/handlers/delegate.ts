/**
 * /fleet/delegate — peer is asking us to execute a single task node on their
 * behalf. The envelope has already been verified by the dispatcher; here we:
 *
 *   1. Write our audit row BEFORE execution (V1 audit-everything constraint)
 *      with a cross-reference to the peer's initiator audit row.
 *   2. Build a synthetic TaskNode from the payload + a minimal RunnerContext.
 *   3. Execute via the default runner (V5 agent engine — same permission gate
 *      and tool registry as a local user-initiated call).
 *   4. Update the audit row with the outcome.
 *   5. Return a signed result envelope that includes our local audit id so
 *      the initiator can record an outbound cross-reference on their side.
 *
 * Local permission profile is the FINAL authority (V6 plan §7) — a peer
 * cannot bypass it. We don't run any pre-check here because the V5 engine
 * already gates every tool call against the active profile.
 */

import { logStartFederated, logComplete } from "../../agent/audit-logger";
import { defaultRunner } from "../../graph/runner-default";
import { createConversation, getSettings } from "../../db/queries";
import type { AgentSpec, Contract, TaskNode, RunnerContext, NodeRunResult, CostActual } from "../../graph/types";
import { ZERO_COST } from "../../graph/types";

export type DelegateRequest = {
  /** Initiator-side audit id — we record it as the peer_audit_id cross-ref. */
  initiator_audit_id: number;
  /** Initiator-side node id (carries through for tracing; we don't create a row). */
  node_id: string;
  agent_spec: AgentSpec;
  input: Record<string, unknown>;
  input_hash: string;
  contract: Contract;
  /** Parent outputs the initiator has computed locally (small payloads only). */
  parent_outputs?: Record<string, unknown>;
  /** Graph-level goal — used as the system prefix for the runner. */
  root_goal: string;
};

export type DelegateResponse = {
  executor_audit_id: number;     // OUR audit row id; initiator stores as cross-ref
  outcome: {
    ok: boolean;
    output: unknown;
    output_text?: string;
    cost: CostActual;
    error?: string;
  };
  /** Lamport of our outgoing reply, useful if the initiator wants per-event ordering. */
  executor_node_id: string;      // initiator's node_id echoed back, for debug
};

/** Build a synthetic TaskNode (not persisted) for the local runner to consume. */
function syntheticNode(payload: DelegateRequest): TaskNode {
  return {
    node_id: payload.node_id,
    graph_id: "delegated",
    parent_ids: [],
    depends_on: [],
    agent_spec: payload.agent_spec,
    input: payload.input,
    input_hash: payload.input_hash,
    contract: payload.contract,
    placement: {},
    status: "running",
    output: null,
    output_hash: null,
    cache_hit_of_node_id: null,
    executing_node_id: null,
    cost_actual: { ...ZERO_COST },
    retry_count: 0,
    last_error: null,
    verification_node_id: null,
    process_id: null,
    started_at: Date.now(),
    completed_at: null,
  };
}

export async function handleDelegate(args: {
  envelope_sender: string;
  envelope_signature: string;
  envelope_lamport: number;
  payload: DelegateRequest;
}): Promise<DelegateResponse> {
  // 1. Audit write BEFORE any execution. Even if the runner crashes, the
  //    receipt of the delegation exists in our chain.
  const auditId = logStartFederated(
    {
      actionType: "delegated_task",
      toolName: "graph_node_runner",
      input: {
        node_id: args.payload.node_id,
        agent_spec: args.payload.agent_spec,
        input: args.payload.input,
        input_hash: args.payload.input_hash,
        root_goal: args.payload.root_goal,
      },
      conversationId: null,
      approvedBy: "rule",
    },
    {
      peer_node_id: args.envelope_sender,
      peer_audit_id: args.payload.initiator_audit_id,
      signature: args.envelope_signature,
      lamport: args.envelope_lamport,
      direction: "inbound",
    }
  );

  // 2. Construct a runner context bound to a fresh per-delegation conversation.
  //    Each delegation gets its own conversation so its trace stays separable
  //    in the V5 orchestration page.
  const conv = createConversation(undefined, undefined);
  const node = syntheticNode(args.payload);
  const ctx: RunnerContext = {
    graph: {
      graph_id: "delegated",
      owner_user_id: null,
      originating_node_id: args.envelope_sender,
      root_goal: args.payload.root_goal,
      status: "running",
      cost_budget: {},
      cost_actual: { ...ZERO_COST },
      parent_audit_id: null,
      created_at: Date.now(),
      completed_at: null,
    },
    parent_outputs: args.payload.parent_outputs ?? {},
    conversation_id: conv.id,
  };

  // 3. Execute. The runner uses runAgentCollect which honours the LOCAL
  //    permission profile — V6 plan §7 (local gate is final authority).
  let result: NodeRunResult;
  try {
    // Guardrail: if the node's agent_spec asks for tools we don't have or
    // don't allow, the V5 engine will refuse them at tool-resolution time.
    // We don't pre-filter here so the audit log captures the exact request.
    if (!getSettings().active_model) {
      result = {
        ok: false,
        output: null,
        cost: { ...ZERO_COST },
        error: "No active model — peer cannot execute LLM-bound nodes",
      };
    } else {
      result = await defaultRunner(node, ctx);
    }
  } catch (e) {
    result = {
      ok: false,
      output: null,
      cost: { ...ZERO_COST },
      error: (e as Error).message ?? "delegate runner threw",
    };
  }

  // 4. Update audit with the outcome.
  logComplete(
    auditId,
    result.ok ? "allowed" : "failed",
    typeof result.output === "string" ? result.output : JSON.stringify(result.output ?? "")
  );

  return {
    executor_audit_id: auditId,
    outcome: {
      ok: result.ok,
      output: result.output,
      output_text: result.output_text,
      cost: result.cost,
      error: result.error,
    },
    executor_node_id: args.payload.node_id,
  };
}
