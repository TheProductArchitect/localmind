import { NextRequest } from "next/server";
import { currentUser, isOwner } from "@/lib/auth/identity";
import { getProcess } from "@/lib/db/agent-processes";
import { buildTrace, type TraceEvent } from "@/lib/agent/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polling-backed SSE. A 1.5s tick re-builds the trace and emits any events that
// weren't sent on a prior tick. Stops when the process is completed/cancelled
// and the final batch has been delivered. Cheap and adequate for V5; a true
// pub/sub bus is a V5.1 swap.
export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const proc = getProcess(params.id);
  const user = currentUser(req);
  if (!proc || !user) return new Response("Not found", { status: 404 });
  if (proc.owner_user_id && proc.owner_user_id !== user.id && !isOwner(req)) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => {
        ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const seen = new Set<string>();
      const aborted = { value: false };
      req.signal.addEventListener("abort", () => { aborted.value = true; });

      const eventKey = (e: TraceEvent) => `${e.timestamp}|${e.event_type}|${e.content}`;

      try {
        for (let tick = 0; !aborted.value && tick < 600; tick++) { // ~15 minutes max
          const current = getProcess(params.id);
          if (!current) { send("error", { message: "Process not found" }); break; }
          const events = buildTrace(params.id);
          for (const e of events) {
            const key = eventKey(e);
            if (seen.has(key)) continue;
            seen.add(key);
            send("trace", e);
          }
          if (current.completed_at) {
            send("done", { status: current.status });
            break;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      } finally {
        try { ctrl.close(); } catch { /* ignore double-close */ }
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
