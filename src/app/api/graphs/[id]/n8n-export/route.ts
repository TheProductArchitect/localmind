/**
 * GET /api/graphs/[id]/n8n-export
 *
 * Download the task graph as n8n-importable JSON. Open n8n → New workflow →
 * "Import from JSON" → paste — you'll see the DAG rendered visually with
 * each task node as a Code node (parameters carry the prompt template +
 * persona + tools as comments).
 *
 * This is for VISUALISATION ONLY — n8n won't actually execute the LocalMind
 * task graph nodes. Once you edit in n8n, it's an n8n workflow, no
 * round-trip back to LocalMind.
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getGraph, listNodes } from "@/lib/db/task-graphs";
import { exportToN8n } from "@/lib/graph/n8n-export";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const graph = getGraph(params.id);
  const user = currentUser(req);
  if (!graph || !user) return NextResponse.json({ error: "Graph not found." }, { status: 404 });
  if (graph.owner_user_id && graph.owner_user_id !== user.id && !isOwner(req)) {
    return NextResponse.json({ error: "Graph not found." }, { status: 404 });
  }

  const nodes = listNodes(params.id);
  const exported = exportToN8n(graph, nodes);
  const filename = `localmind-graph-${params.id.slice(-12)}.json`;

  return new Response(JSON.stringify(exported, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
