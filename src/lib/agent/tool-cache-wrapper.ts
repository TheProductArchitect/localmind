/**
 * Tool-call cache wrapper. The agent engine calls `executeWithCache` instead
 * of `tool.execute` so cacheable idempotent reads hit the V6.3 tool_call_cache
 * table instead of re-running.
 *
 * Behaviour:
 *   - If the tool doesn't declare `cacheable` or it returns false for this
 *     input, the call goes straight through; no cache writes either.
 *   - If cacheable AND the cache has a successful hit for
 *     (tool_name, tool_version, input_hash), return the cached output. The
 *     audit log STILL records the call — V1 audit-everything; we just mark
 *     the row's output_summary so a user reading the log sees the cache hit.
 *   - On miss, execute normally. If the result was `ok: true`, persist it.
 *     Failures are never cached (a flaky tool's transient error shouldn't
 *     poison the next call).
 *
 * Outputs larger than MAX_CACHE_OUTPUT_BYTES (64 KiB) skip the cache write
 * to keep the cache table bounded; the call still executes and returns
 * normally, just without storing.
 */

import type { Tool, ToolContext, ToolResult } from "../tools/types";
import {
  lookup,
  store,
  computeToolInputHash,
} from "../db/tool-call-cache";

const MAX_CACHE_OUTPUT_BYTES = 64 * 1024;
const CACHE_HIT_PREFIX = "[cache-hit] ";

export type CachedToolResult = ToolResult & {
  cache_hit?: boolean;
  cache_age_ms?: number;
};

export async function executeWithCache(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<CachedToolResult> {
  const eligible = typeof tool.cacheable === "function" ? tool.cacheable(input) : false;
  if (!eligible) {
    return tool.execute(input, ctx);
  }

  const toolVersion = tool.version ?? "1";
  const inputHash = computeToolInputHash(input);
  const toolName = tool.definition.name;

  const cached = lookup(toolName, toolVersion, inputHash);
  if (cached && cached.status === "ok") {
    const output = typeof cached.output === "string" ? cached.output : JSON.stringify(cached.output);
    return {
      ok: true,
      output,
      summary: `${CACHE_HIT_PREFIX}${tool.definition.name} (age ${Math.max(0, Date.now() - cached.created_at)}ms)`,
      cache_hit: true,
      cache_age_ms: Date.now() - cached.created_at,
    };
  }

  const t0 = Date.now();
  const result = await tool.execute(input, ctx);
  const wallSeconds = (Date.now() - t0) / 1000;

  // Persist only successful, bounded outputs.
  if (result.ok && Buffer.byteLength(result.output, "utf8") <= MAX_CACHE_OUTPUT_BYTES) {
    try {
      store({
        tool_name: toolName,
        tool_version: toolVersion,
        input_hash: inputHash,
        output: result.output,
        status: "ok",
        cost: { tokens: 0, wall_seconds: wallSeconds, usd: 0 },
      });
    } catch {
      // Cache writes are best-effort — never let a cache failure break the
      // user-visible tool result.
    }
  }
  return result;
}
