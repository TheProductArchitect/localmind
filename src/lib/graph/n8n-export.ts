/**
 * Convert a V6 task graph to n8n's workflow JSON format.
 *
 * Why this exists: when Sora builds a multi-step task graph, the user often
 * wants to SEE it as a workflow. n8n is a great visual editor that's already
 * self-hosted by many users — exporting to its native JSON format lets you
 * paste the graph straight into n8n's "Import from JSON" and see the DAG
 * rendered visually.
 *
 * Mapping:
 *   - Each task_nodes row → an n8n node with type 'n8n-nodes-base.code'
 *     and inputs/outputs derived from depends_on edges
 *   - Node positions are auto-laid-out as a left-to-right topological grid
 *     (depth on X axis, sibling index on Y axis)
 *   - The agent_spec.prompt_template + agent_spec.persona_id end up in the
 *     node's parameters JSON so a user can inspect them in n8n's editor
 *
 * Limits:
 *   - n8n's runtime won't ACTUALLY execute our task graph nodes (they're not
 *     real n8n node types). This is for visualisation only.
 *   - We don't attempt to round-trip — once an n8n user edits the workflow,
 *     it's an n8n artefact, not a LocalMind task graph.
 */

import type { TaskGraph, TaskNode } from "./types";

export type N8nExport = {
  name: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters: Record<string, unknown>;
    notes?: string;
  }>;
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
  active: false;
  settings: { executionOrder: "v1" };
  meta: {
    instanceId: string;
    source: "localmind";
    graph_id: string;
    exported_at: number;
  };
};

const X_STEP = 220;
const Y_STEP = 140;

/**
 * Compute depth of each node (longest path from a leaf-input to it). Sibling
 * index within depth determines Y position.
 */
function layoutPositions(nodes: TaskNode[]): Map<string, [number, number]> {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const depth = new Map<string, number>();

  function depthOf(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const n = byId.get(id);
    if (!n || n.depends_on.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const dep of n.depends_on) d = Math.max(d, depthOf(dep) + 1);
    depth.set(id, d);
    return d;
  }
  for (const n of nodes) depthOf(n.node_id);

  // Bucket by depth, assign Y by order.
  const buckets = new Map<number, TaskNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.node_id) ?? 0;
    const arr = buckets.get(d) ?? [];
    arr.push(n);
    buckets.set(d, arr);
  }

  const out = new Map<string, [number, number]>();
  for (const [d, group] of buckets) {
    group.forEach((n, i) => {
      out.set(n.node_id, [d * X_STEP, i * Y_STEP]);
    });
  }
  return out;
}

export function exportToN8n(graph: TaskGraph, nodes: TaskNode[]): N8nExport {
  const positions = layoutPositions(nodes);

  const exportNodes: N8nExport["nodes"] = nodes.map((n) => {
    const pos = positions.get(n.node_id) ?? [0, 0];
    return {
      id: n.node_id,
      name: n.agent_spec.prompt_template.slice(0, 50).replace(/\n/g, " ").trim() || n.node_id,
      // We use the Code node so the prompt + tool spec is editable inline.
      // Future: a dedicated "LocalMind Task Node" community node would be cleaner,
      // but plain Code keeps imports working out-of-the-box on every n8n install.
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: pos,
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: [
          `// LocalMind task node ${n.node_id}`,
          `// Persona: ${n.agent_spec.persona_id}`,
          `// Tools: ${n.agent_spec.tools.join(", ") || "(default set)"}`,
          `// Status when exported: ${n.status}`,
          `//`,
          `// Prompt template:`,
          ...n.agent_spec.prompt_template.split("\n").map((l) => `// ${l}`),
          ``,
          `return items;`,
        ].join("\n"),
      },
      notes: [
        `Status: ${n.status}`,
        `Persona: ${n.agent_spec.persona_id}`,
        `Tools: ${n.agent_spec.tools.join(", ") || "(default set)"}`,
        n.contract.success_predicate ? `Success: ${n.contract.success_predicate}` : "",
        n.last_error ? `Last error: ${n.last_error}` : "",
      ].filter(Boolean).join("\n"),
    };
  });

  // Build connections: depends_on → main inputs in n8n's edge format.
  const connections: N8nExport["connections"] = {};
  for (const n of nodes) {
    for (const depId of n.depends_on) {
      const depNode = nodes.find((x) => x.node_id === depId);
      if (!depNode) continue;
      const sourceName = depNode.agent_spec.prompt_template.slice(0, 50).replace(/\n/g, " ").trim() || depNode.node_id;
      const targetName = n.agent_spec.prompt_template.slice(0, 50).replace(/\n/g, " ").trim() || n.node_id;
      const list = connections[sourceName] ?? { main: [[]] };
      if (!list.main[0]) list.main[0] = [];
      list.main[0].push({ node: targetName, type: "main", index: 0 });
      connections[sourceName] = list;
    }
  }

  return {
    name: `LocalMind: ${graph.root_goal.slice(0, 60)}`,
    nodes: exportNodes,
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    meta: {
      instanceId: "localmind",
      source: "localmind",
      graph_id: graph.graph_id,
      exported_at: Date.now(),
    },
  };
}
