import { listGoals, type Goal } from "./db/goals";
import { listMemory } from "./db/queries";
import { listEdges, type BrainEdge } from "./db/brain";

// The User Context Graph (§12): a durable, user-rooted model of the user's
// world — goals, needs, people, preferences — assembled from existing stores.
// Distinct from the Ops board (agent activity). Read-mostly; the user steers it.

// Taxonomies as runtime data so they're queryable via /api/context/meta and
// the type is derived from a single source.
export const NODE_KINDS = [
  "user", "goal", "need", "project", "person",
  "commitment", "preference", "interest", "resource", "entity",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  "wants", "needs", "responsible_for", "knows", "cares_about",
  "part_of", "involves", "due", "prefers", "blocks", "about",
  "mentioned_in", "works_at", "related_to",
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const SOURCES = ["stated", "inferred", "imported"] as const;
export type Source = (typeof SOURCES)[number];

export type ContextNode = {
  id: string;
  kind: NodeKind;
  label: string;
  source: Source;
  ref?: string; // stable id back to the underlying store (goal id, memory key, …)
};
export type ContextLink = { source: string; target: string; type: string };
export type ContextGraph = { nodes: ContextNode[]; links: ContextLink[] };

export const USER_NODE_ID = "user";

type AssembleInput = {
  userName?: string;
  goals: Goal[];
  memory: { key: string; value: string }[];
  brainEdges: BrainEdge[];
};

/** Pure graph assembly — no DB access, so it's unit-testable. */
export function assembleContextGraph(input: AssembleInput): ContextGraph {
  const nodes: ContextNode[] = [];
  const links: ContextLink[] = [];
  const seen = new Set<string>();
  const add = (n: ContextNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  // The You node — the root everything hangs off.
  add({ id: USER_NODE_ID, kind: "user", label: input.userName || "You", source: "stated" });

  // Goals → wants edges. Dropped/done goals are excluded from the live view.
  for (const g of input.goals) {
    if (g.status === "dropped") continue;
    const id = `goal:${g.id}`;
    const due = g.target_date ? ` (due ${g.target_date})` : "";
    add({ id, kind: "goal", label: `${g.description}${due}`, source: "stated", ref: g.id });
    links.push({ source: USER_NODE_ID, target: id, type: "wants" });
  }

  // Memory → preference nodes the user can confirm/correct.
  for (const m of input.memory) {
    const id = `pref:${m.key}`;
    add({ id, kind: "preference", label: `${m.key}: ${m.value}`, source: "stated", ref: m.key });
    links.push({ source: USER_NODE_ID, target: id, type: "prefers" });
  }

  // Brain entity graph → typed edges between entities. Entities inherit the
  // edge's source so the UI can dash unconfirmed inferences.
  for (const e of input.brainEdges) {
    for (const slug of [e.src_entity, e.dst_entity]) {
      add({ id: `entity:${slug}`, kind: "entity", label: slug.replace(/-/g, " "), source: e.source, ref: slug });
    }
    links.push({ source: `entity:${e.src_entity}`, target: `entity:${e.dst_entity}`, type: e.edge_type });
  }

  return { nodes, links };
}

/** DB-backed assembly for the current user. Goals with no owner are shared. */
export function getContextGraph(userId?: string | null, userName?: string): ContextGraph {
  const goals = listGoals().filter((g) => !userId || !g.user_id || g.user_id === userId);
  const memory = listMemory(userId ?? undefined).map((m) => ({ key: m.key, value: m.value }));
  const brainEdges = listEdges();
  return assembleContextGraph({ userName, goals, memory, brainEdges });
}
