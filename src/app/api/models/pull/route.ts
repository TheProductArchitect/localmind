import { NextRequest } from "next/server";
import { pullModel } from "@/lib/providers/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name) return new Response("name required", { status: 400 });

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) =>
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        await pullModel(name, (pct, status) => send({ type: "progress", pct, status }), controller.signal);
        send({ type: "done" });
      } catch (e: any) {
        send({ type: "error", message: e?.message || "Pull failed" });
      } finally {
        ctrl.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
