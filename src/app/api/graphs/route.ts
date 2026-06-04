/**
 * GET /api/graphs — list task graphs (most recent first, capped at 50).
 *
 * No POST here: graphs are constructed by the executor / build helpers, not
 * created directly through this endpoint. A future graph-as-chat endpoint
 * (V6.9+) will live elsewhere.
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { listGraphs, listNodes } from "@/lib/db/task-graphs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const scope = user && !isOwner(req) ? user.id : null;
  const graphs = listGraphs(scope, 50).map((g) => {
    // Cheap rollup for the list view — avoid loading full nodes per row.
    const nodes = listNodes(g.graph_id);
    const counts = {
      total: nodes.length,
      done: nodes.filter((n) => n.status === "done" || n.status === "cached").length,
      running: nodes.filter((n) => n.status === "running" || n.status === "scheduled").length,
      failed: nodes.filter((n) => n.status === "failed" || n.status === "refuted").length,
    };
    return {
      ...g,
      node_counts: counts,
    };
  });
  return NextResponse.json({ graphs });
}
