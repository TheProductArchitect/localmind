/**
 * Bootstrap a built-in MCP server.
 *
 * The spawned `bootstrap.sh` does heavy network work (pip + playwright cdn)
 * which the MCP outbound proxy would block if invoked from a child MCP
 * process. We launch it directly here — Node parent, no proxy env — so the
 * one-time install actually completes. Streamed back as text/plain so the
 * UI can show progress live.
 */
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { BUILTIN_MCP_SERVERS, isBuiltinBootstrapped } from "@/lib/mcp/builtins";
import { setMcpEnabled, getMcpServer } from "@/lib/db/mcp";
import { refreshServerTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({ id: "" }));
  const spec = BUILTIN_MCP_SERVERS.find((s) => s.id === id);
  if (!spec) {
    return new Response(JSON.stringify({ error: "Unknown builtin id" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (!spec.relativeBootstrap) {
    return new Response(JSON.stringify({ error: "Builtin has no bootstrap step" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const script = path.resolve(process.cwd(), spec.relativeBootstrap);
  if (!fs.existsSync(script)) {
    return new Response(JSON.stringify({ error: `Bootstrap script not found at ${script}` }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawn("bash", [script], {
        cwd: path.dirname(script),
        // CRITICAL: do not inject the MCP outbound proxy here. pip and
        // playwright need direct internet access to download wheels + the
        // chromium build.
        env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" },
      });
      const enc = new TextEncoder();
      child.stdout.on("data", (d) => controller.enqueue(enc.encode(d.toString())));
      child.stderr.on("data", (d) => controller.enqueue(enc.encode(d.toString())));
      child.on("close", async (code) => {
        if (code === 0 && isBuiltinBootstrapped(spec)) {
          // Auto-enable + connect now that the server can actually run.
          // refreshServerTools updates the in-memory health map so the UI
          // sees "connecting" → "connected" without a manual Restart click.
          try { setMcpEnabled(spec.id, true); } catch {}
          const row = getMcpServer(spec.id);
          if (row) {
            controller.enqueue(enc.encode("[step] connecting\n"));
            const res = await refreshServerTools(row);
            controller.enqueue(enc.encode(
              res.ok ? "[step] connected\n" : `[error] connect failed: ${res.error || "unknown"}\n`
            ));
          }
          controller.enqueue(enc.encode(`\n[done] exit=${code}\n`));
        } else {
          controller.enqueue(enc.encode(`\n[failed] exit=${code}\n`));
        }
        controller.close();
      });
      child.on("error", (e) => {
        controller.enqueue(enc.encode(`\n[spawn error] ${e.message}\n`));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
