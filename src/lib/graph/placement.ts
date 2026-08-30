/**
 * Placement engine — given a node's requirements and the current capability
 * snapshots of paired peers + the local node, pick where the node should run.
 *
 * Algorithm (V6 plan §5):
 *
 *   1. Honour `placement.preferred_node_id` if that target is reachable AND
 *      satisfies the requirements. If the preference can't be met, fall
 *      through to general selection (we never silently retarget to a peer
 *      the user didn't ask for without explaining why).
 *
 *   2. Build the candidate set: local + each paired peer whose cached
 *      capabilities cover `required_tools` and `required_model_class`. Peers
 *      whose last_seen_at is older than the freshness threshold (90s, per
 *      §5) are treated as unavailable.
 *
 *   3. Pick the candidate with the lowest `current_load.active_processes`.
 *      Tie-break to local — local execution avoids the network round-trip
 *      and the additional audit cross-references when load is otherwise
 *      equal.
 *
 *   4. If no candidate matches the requirements, return a decision that
 *      pins the node locally and surfaces the reason. The executor will
 *      mark the node failed if the local runner also can't satisfy them.
 *
 * Stays purely functional — no DB writes, no I/O. The placement runner does
 * the orchestration; this module just answers "where should this go?".
 */

import type { Capability } from "../fleet/capabilities";
import type { Placement } from "./types";

const FRESHNESS_MS = 90_000;

export type PlacementTarget =
  | { kind: "local" }
  | { kind: "peer"; peer_node_id: string };

export type PlacementDecision = {
  target: PlacementTarget;
  reason: string;
  considered: Array<{ node_id: string; isLocal: boolean; load: number; matched: boolean; reason?: string }>;
};

export type PeerCandidate = {
  node_id: string;
  capabilities: Partial<Capability>;
  last_seen_at: number | null;
};

function matchesTools(caps: Partial<Capability>, required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  const have = new Set(caps.tools ?? []);
  return required.every((t) => have.has(t));
}

/**
 * Heuristic model-class matcher. Tight enough to be useful, loose enough to
 * not block legitimate execution. Refine in V6.6 with the curated model
 * registry (see V5 model-context-overrides KNOWN map).
 */
function matchesModelClass(caps: Partial<Capability>, klass?: Placement["required_model_class"]): boolean {
  if (!klass) return true;
  const models = caps.models ?? [];
  if (models.length === 0) return false;
  switch (klass) {
    case "large":
      return models.some((m) => /(70b|72b|405b|34b|27b|22b)/i.test(m.name));
    case "fast":
      // "fast" means there's at least one small-or-medium model installed; any
      // model qualifies because most home LLM rigs have something <=8b.
      return true;
    case "tool-calling":
      // Modern Llama / Qwen / Mistral all support tools. Excluding only the
      // known holdouts (Phi-3, ancient codellama variants without tools).
      return models.some((m) => !/^phi3(?!\.)/i.test(m.name));
  }
}

function freshEnough(peer: PeerCandidate): boolean {
  if (peer.last_seen_at === null) return false;
  return Date.now() - peer.last_seen_at <= FRESHNESS_MS;
}

function loadOf(caps: Partial<Capability>): number {
  return caps.current_load?.active_processes ?? 0;
}

function hasGpu(caps: Partial<Capability>): boolean {
  return caps.gpu_available === true;
}

/** True when the node advertises a large (roughly 20B+) local model. */
function hasLargeModel(caps: Partial<Capability>): boolean {
  return (caps.models ?? []).some((m) => /(70b|72b|405b|34b|32b|30b|27b|26b|22b|20b)/i.test(m.name));
}

export type PlacementOpts = {
  /**
   * Chat / LLM-heavy work: prefer a GPU-backed peer with big models over an
   * idle-but-weak node. Used by chat Auto so a DGX-class hub wins over a
   * laptop that merely has fewer active processes.
   */
  preferGpu?: boolean;
};

export function decidePlacement(
  placement: Placement,
  localCaps: Capability,
  peers: PeerCandidate[],
  opts?: PlacementOpts
): PlacementDecision {
  const considered: PlacementDecision["considered"] = [];

  // Step 1: explicit preference.
  if (placement.preferred_node_id) {
    if (placement.preferred_node_id === localCaps.node_id) {
      if (matchesTools(localCaps, placement.required_tools) && matchesModelClass(localCaps, placement.required_model_class)) {
        return {
          target: { kind: "local" },
          reason: "preferred=local",
          considered: [{ node_id: localCaps.node_id, isLocal: true, load: loadOf(localCaps), matched: true }],
        };
      }
      // Preference is local but reqs don't match locally — fall through.
    } else {
      const pref = peers.find((p) => p.node_id === placement.preferred_node_id);
      if (pref && freshEnough(pref) && matchesTools(pref.capabilities, placement.required_tools) && matchesModelClass(pref.capabilities, placement.required_model_class)) {
        return {
          target: { kind: "peer", peer_node_id: pref.node_id },
          reason: `preferred=${pref.node_id.slice(0, 12)}`,
          considered: [{ node_id: pref.node_id, isLocal: false, load: loadOf(pref.capabilities), matched: true }],
        };
      }
      // Preference unreachable or incapable — fall through but record why.
      considered.push({
        node_id: placement.preferred_node_id,
        isLocal: false,
        load: -1,
        matched: false,
        reason: !pref ? "unknown peer" : !freshEnough(pref) ? "stale heartbeat" : "missing required tools/model",
      });
    }
  }

  // Step 2: enumerate candidates.
  const localMatches = matchesTools(localCaps, placement.required_tools) && matchesModelClass(localCaps, placement.required_model_class);
  considered.push({
    node_id: localCaps.node_id,
    isLocal: true,
    load: loadOf(localCaps),
    matched: localMatches,
    reason: localMatches ? undefined : "local missing required tools/model",
  });

  type Sortable = { isLocal: boolean; node_id: string; load: number; gpu: boolean; large: boolean };
  const matched: Sortable[] = [];
  if (localMatches)
    matched.push({
      isLocal: true,
      node_id: localCaps.node_id,
      load: loadOf(localCaps),
      gpu: hasGpu(localCaps),
      large: hasLargeModel(localCaps),
    });

  for (const peer of peers) {
    if (peer.node_id === localCaps.node_id) continue; // loopback paths in self-tests
    const fresh = freshEnough(peer);
    const toolsOk = matchesTools(peer.capabilities, placement.required_tools);
    const modelOk = matchesModelClass(peer.capabilities, placement.required_model_class);
    const ok = fresh && toolsOk && modelOk;
    considered.push({
      node_id: peer.node_id,
      isLocal: false,
      load: loadOf(peer.capabilities),
      matched: ok,
      reason: ok ? undefined : !fresh ? "stale heartbeat" : !toolsOk ? "missing tools" : "missing model class",
    });
    if (ok)
      matched.push({
        isLocal: false,
        node_id: peer.node_id,
        load: loadOf(peer.capabilities),
        gpu: hasGpu(peer.capabilities),
        large: hasLargeModel(peer.capabilities),
      });
  }

  if (matched.length === 0) {
    return {
      target: { kind: "local" },
      reason: "no candidate met the requirements — falling back to local; node may fail at runtime",
      considered,
    };
  }

  // Step 3 (GPU-aware, chat/LLM work): a fresh GPU peer with big models beats
  // an idle-but-weak node. Rank by GPU, then large-model presence, then load;
  // tie-break to local to avoid a needless hop.
  if (opts?.preferGpu) {
    const score = (c: Sortable) => (c.gpu ? 4 : 0) + (c.large ? 2 : 0);
    matched.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sb - sa;
      if (a.load !== b.load) return a.load - b.load;
      return a.isLocal ? -1 : 1;
    });
    const winner = matched[0];
    const why = winner.gpu
      ? `GPU peer${winner.large ? " with large model" : ""} (load ${winner.load})`
      : `lowest load (${winner.load} active processes)`;
    return {
      target: winner.isLocal ? { kind: "local" } : { kind: "peer", peer_node_id: winner.node_id },
      reason: why,
      considered,
    };
  }

  // Default: pick lowest load; tie-break to local.
  matched.sort((a, b) => (a.load !== b.load ? a.load - b.load : a.isLocal ? -1 : 1));
  const winner = matched[0];
  return {
    target: winner.isLocal ? { kind: "local" } : { kind: "peer", peer_node_id: winner.node_id },
    reason: `lowest load (${winner.load} active processes)`,
    considered,
  };
}
