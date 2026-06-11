import { NextRequest } from "next/server";
import { pullModel } from "@/lib/providers/ollama";
import { pullHuggingfaceModel } from "@/lib/providers/huggingface";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/models/pull
 *
 * Body shapes:
 *   { provider: "ollama", name: "llama3.2:3b" }
 *   { provider: "huggingface", repo: "...", file: "...", ollamaName?: "...", token?: "..." }
 *
 * Streams Server-Sent Events: { type: "progress" | "done" | "error", ... }.
 * LM Studio is intentionally not handled here — downloads happen inside the
 * LM Studio app itself; we just list what's already loaded.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const provider = String(body.provider || "ollama").toLowerCase();

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) =>
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        if (provider === "huggingface") {
          if (!body.repo || !body.file) {
            send({ type: "error", message: "repo and file are required for huggingface pulls" });
            return;
          }
          const result = await pullHuggingfaceModel(
            { repo: body.repo, file: body.file, ollamaName: body.ollamaName, token: body.token },
            (pct, status, bytes, total) => send({ type: "progress", pct, status, bytes, total }),
            controller.signal
          );
          send({ type: "done", path: result.path, ollama: result.ollama });
        } else if (provider === "lmstudio") {
          send({
            type: "error",
            message:
              "LM Studio does not expose a download API — open LM Studio and download the model from its Models tab, then refresh here.",
          });
        } else {
          if (!body.name) {
            send({ type: "error", message: "name is required for ollama pulls" });
            return;
          }
          await pullModel(
            body.name,
            (pct, status) => send({ type: "progress", pct, status }),
            controller.signal
          );
          send({ type: "done" });
        }
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
