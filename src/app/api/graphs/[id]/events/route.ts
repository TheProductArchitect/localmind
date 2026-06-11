/**
 * SSE stream of graph node-state changes. Polling-backed (1s tick) — emits a
 * `node` event whenever a node's status, cost, or output_hash changes, plus
 * a `graph` event when the top-level graph status flips. Closes when the
 * graph completes / fails / is cancelled and the final batch has shipped.
 *
 * Same pattern as the V6.1 trace stream: simple, no pub/sub bus required,
 * and the 1s cadence is fine for human-watched UIs. A real bus (pg LISTEN
 * or a Node EventEmitter wired into setNodeStatus) is a V6.9 polish.
 */

import { NextRequest } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getGraph, listNodes } from "@/lib/db/task-graphs";
import type { TaskNode, TaskGraph } from "@/lib/graph/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 1000;
const MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes — hard ceiling

function nodeSignature(n: TaskNode): string {
  // Fields the UI cares about — bump version when any of them changes.
  return `${n.status}|${n.cost_actual.tokens}|${n.cost_actual.wall_seconds}|${n.output_hash ?? ""}|${n.last_error ?? ""}|${n.cache_hit_of_node_id ?? ""}|${n.executing_node_id ?? ""}`;
}

function graphSignature(g: TaskGraph): string {
  return `${g.status}|${g.cost_actual.tokens}|${g.cost_actual.wall_seconds}|${g.completed_at ?? ""}`;
}

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const initial = getGraph(params.id);
  const user = currentUser(req);
  if (!initial || !user) return new Response("Not found", { status: 404 });
  if (initial.owner_user_id && initial.owner_user_id !== user.id && !isOwner(req)) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => {
        ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const nodeSigs = new Map<string, string>();
      let graphSig = "";
      const aborted = { value: false };
      req.signal.addEventListener("abort", () => { aborted.value = true; });
      const deadline = Date.now() + MAX_DURATION_MS;

      // Initial snapshot.
      const initNodes = listNodes(params.id);
      send("graph", initial);
      graphSig = graphSignature(initial);
      for (const n of initNodes) {
        send("node", n);
        nodeSigs.set(n.node_id, nodeSignature(n));
      }

      try {
        while (!aborted.value && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, TICK_MS));
          if (aborted.value) break;

          const g = getGraph(params.id);
          if (!g) { send("error", { reason: "graph deleted" }); break; }
          const sig = graphSignature(g);
          if (sig !== graphSig) {
            send("graph", g);
            graphSig = sig;
          }
          const nodes = listNodes(params.id);
          for (const n of nodes) {
            const cur = nodeSignature(n);
            const prev = nodeSigs.get(n.node_id);
            if (prev !== cur) {
              send("node", n);
              nodeSigs.set(n.node_id, cur);
            }
          }
          if (g.completed_at) {
            // One last sweep already done above; close.
            send("done", { status: g.status });
            break;
          }
        }
      } finally {
        try { ctrl.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
