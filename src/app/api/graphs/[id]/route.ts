/**
 * GET    /api/graphs/[id]  — full graph detail with all nodes
 * DELETE /api/graphs/[id]  — cancel graph (best-effort: marks status=cancelled
 *                            so the running executor exits at the next loop)
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getGraph, listNodes, setGraphStatus, setNodeStatus } from "@/lib/db/task-graphs";

export const runtime = "nodejs";

function authorise(req: NextRequest, graphId: string) {
  const graph = getGraph(graphId);
  const user = currentUser(req);
  if (!graph || !user) return { graph: null, user };
  if (graph.owner_user_id && graph.owner_user_id !== user.id && !isOwner(req)) {
    return { graph: null, user };
  }
  return { graph, user };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { graph } = authorise(req, params.id);
  if (!graph) return NextResponse.json({ error: "Graph not found." }, { status: 404 });
  const nodes = listNodes(params.id);
  return NextResponse.json({ graph, nodes });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { graph } = authorise(req, params.id);
  if (!graph) return NextResponse.json({ error: "Graph not found." }, { status: 404 });
  if (graph.completed_at) {
    return NextResponse.json({ ok: true, alreadyCompleted: true });
  }
  // Mark the graph cancelled — the executor's main loop reads status fresh
  // each iteration and exits when it sees this. In-flight node runs finish
  // naturally; their cost still rolls up.
  setGraphStatus(params.id, "cancelled");
  // Pending nodes get cancelled too so the UI reflects them as deliberately
  // stopped rather than abandoned.
  for (const n of listNodes(params.id)) {
    if (n.status === "pending" || n.status === "scheduled") {
      setNodeStatus(n.node_id, "cancelled", { last_error: "Graph cancelled by user." });
    }
  }
  return NextResponse.json({ ok: true });
}
