import { describe, it, expect } from "vitest";
import { assembleContextGraph, USER_NODE_ID } from "../src/lib/context-graph";

function goal(over: any = {}) {
  return {
    id: "g1", user_id: null, description: "Ship v2", target_date: "2026-08-01",
    milestones: "[]", progress_notes: "[]", progress: 0, status: "active", created_at: 0,
    ...over,
  };
}
function edge(over: any = {}) {
  return { id: "e1", src_entity: "alice", dst_entity: "acme", edge_type: "works_at", source: "inferred", weight: 1, created_at: 0, ...over };
}

describe("assembleContextGraph", () => {
  it("roots the graph at a single You node", () => {
    const g = assembleContextGraph({ userName: "Venu", goals: [], memory: [], brainEdges: [] });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ id: USER_NODE_ID, kind: "user", label: "Venu" });
  });

  it("links goals to the user via 'wants' and includes the due date", () => {
    const g = assembleContextGraph({ goals: [goal()], memory: [], brainEdges: [] });
    const goalNode = g.nodes.find((n) => n.id === "goal:g1");
    expect(goalNode?.label).toContain("due 2026-08-01");
    expect(g.links).toContainEqual({ source: USER_NODE_ID, target: "goal:g1", type: "wants" });
  });

  it("excludes dropped goals", () => {
    const g = assembleContextGraph({ goals: [goal({ status: "dropped" })], memory: [], brainEdges: [] });
    expect(g.nodes.find((n) => n.id === "goal:g1")).toBeUndefined();
  });

  it("turns memory into preference nodes linked via 'prefers'", () => {
    const g = assembleContextGraph({ goals: [], memory: [{ key: "tone", value: "concise" }], brainEdges: [] });
    expect(g.nodes.find((n) => n.id === "pref:tone")?.label).toBe("tone: concise");
    expect(g.links).toContainEqual({ source: USER_NODE_ID, target: "pref:tone", type: "prefers" });
  });

  it("includes brain entities and typed edges, inheriting the edge source", () => {
    const g = assembleContextGraph({ goals: [], memory: [], brainEdges: [edge()] });
    expect(g.nodes.find((n) => n.id === "entity:alice")?.source).toBe("inferred");
    expect(g.links).toContainEqual({ source: "entity:alice", target: "entity:acme", type: "works_at" });
  });

  it("dedupes shared entity nodes across edges", () => {
    const g = assembleContextGraph({
      goals: [], memory: [],
      brainEdges: [edge(), edge({ id: "e2", dst_entity: "bob", edge_type: "knows" })],
    });
    const aliceNodes = g.nodes.filter((n) => n.id === "entity:alice");
    expect(aliceNodes).toHaveLength(1);
  });
});
