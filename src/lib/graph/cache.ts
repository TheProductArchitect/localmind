/**
 * Node-output cache lookup. Sits in front of the executor's scheduling step:
 * when a node becomes eligible to run, we check whether a prior node in any
 * graph (owned by the same user, including unowned/null graphs) has the same
 * `input_hash` and a successful output. If so, we reuse it.
 *
 * The hash is computed by `computeInputHash(input, agent_spec)` in the DB
 * layer — it covers persona, tool set, prompt template, and input. Two nodes
 * with identical hashes are by construction interchangeable; their outputs
 * are interchangeable too.
 *
 * Cache MISS is the right behaviour for any node with `requires_verification`
 * set — a refute pass might reject the prior output, so we always re-verify.
 * Re-running is cheaper than re-verifying-then-rejecting because the second
 * verifier might agree this time and the prior verifier was wrong. Skip cache
 * for verification-required nodes — caller controls this.
 */

import { findCachedNodeByInputHash } from "../db/task-graphs";
import type { TaskNode } from "./types";

export type CacheLookupResult =
  | { hit: true; source_node_id: string; output: unknown; output_hash: string | null }
  | { hit: false };

export function lookupNodeCache(
  node: TaskNode,
  ownerUserId: string | null
): CacheLookupResult {
  // Verification-required nodes never read cache — re-running is cheap and
  // guarantees the verifier sees a fresh output.
  if (node.agent_spec.requires_verification) return { hit: false };

  const prior = findCachedNodeByInputHash(node.input_hash, node.graph_id, ownerUserId);
  if (!prior) return { hit: false };

  return {
    hit: true,
    source_node_id: prior.node_id,
    output: prior.output,
    output_hash: prior.output_hash,
  };
}
