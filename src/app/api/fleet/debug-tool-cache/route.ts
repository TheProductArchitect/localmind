/**
 * V6.7 self-test: tool-call cache interception.
 *
 * Strategy:
 *   1. Pick a tool with deterministic, cacheable output. `memory` with
 *      operation=read is ideal — it lists what's in the memory table, which
 *      is stable across calls in the same process.
 *   2. Clear any prior cache entries for that (tool, version, input_hash).
 *   3. Call the tool via the cache wrapper once — expect a cache MISS, the
 *      output to come from execute(), and a new cache entry to be persisted.
 *   4. Call again with identical input — expect a cache HIT, the same output,
 *      and the summary to start with "[cache-hit]".
 *   5. Mutate the input slightly so the input_hash differs — expect a fresh
 *      execute() and a second cache entry.
 *   6. Verify a non-cacheable op (memory write) does NOT touch the cache
 *      regardless of how many times we call it.
 */

import { NextResponse } from "next/server";
import { executeWithCache } from "@/lib/agent/tool-cache-wrapper";
import { memoryTool } from "@/lib/tools/memory";
import { computeToolInputHash, lookup, invalidateTool, stats } from "@/lib/db/tool-call-cache";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Clear any prior memory-tool cache entries so test runs are deterministic.
  invalidateTool("memory");

  const ctx = { conversationId: "tool-cache-test", approvedDirs: [] as string[] };
  const readInput = { operation: "read" } as Record<string, unknown>;
  const readInputHash = computeToolInputHash(readInput);

  // 2. First call — expect MISS, real execute(), and a new cache row.
  try {
    const t0 = Date.now();
    const r1 = await executeWithCache(memoryTool, readInput, ctx);
    const wallFirst = Date.now() - t0;
    const cachedAfter = lookup("memory", memoryTool.version ?? "1", readInputHash);
    results.push({
      name: "first_call_misses_then_stores",
      ok: r1.ok && !r1.cache_hit && cachedAfter !== null,
      detail: `ok=${r1.ok} cache_hit=${r1.cache_hit} wall=${wallFirst}ms stored=${cachedAfter !== null}`,
    });
  } catch (e) {
    results.push({ name: "first_call_misses_then_stores", ok: false, detail: (e as Error).message });
  }

  // 3. Second call — expect HIT, same output, summary marked.
  try {
    const t0 = Date.now();
    const r2 = await executeWithCache(memoryTool, readInput, ctx);
    const wallHit = Date.now() - t0;
    const summaryMarked = (r2.summary || "").startsWith("[cache-hit]");
    results.push({
      name: "second_call_hits_cache",
      ok: r2.ok && r2.cache_hit === true && summaryMarked,
      detail: `cache_hit=${r2.cache_hit} summary="${r2.summary ?? ""}" wall=${wallHit}ms`,
    });
  } catch (e) {
    results.push({ name: "second_call_hits_cache", ok: false, detail: (e as Error).message });
  }

  // 4. Different input → new entry.
  try {
    const altInput = { operation: "read", _bust: `unique-${Date.now()}` };
    const altHash = computeToolInputHash(altInput);
    const r3 = await executeWithCache(memoryTool, altInput, ctx);
    const cachedAlt = lookup("memory", memoryTool.version ?? "1", altHash);
    const sameAsOriginal = altHash === readInputHash;
    results.push({
      name: "different_input_creates_new_entry",
      ok: r3.ok && !r3.cache_hit && cachedAlt !== null && !sameAsOriginal,
      detail: `cache_hit=${r3.cache_hit} alt_stored=${cachedAlt !== null} hash_differs=${!sameAsOriginal}`,
    });
  } catch (e) {
    results.push({ name: "different_input_creates_new_entry", ok: false, detail: (e as Error).message });
  }

  // 5. Non-cacheable op — write call must NOT add cache rows even if we run
  //    it twice. We measure the cache total before and after.
  try {
    const before = stats().total;
    const writeInput = { operation: "write", key: `cache-test-${Date.now()}`, value: "v" };
    const w1 = await executeWithCache(memoryTool, writeInput, ctx);
    const w2 = await executeWithCache(memoryTool, writeInput, ctx);
    const after = stats().total;
    results.push({
      name: "write_op_bypasses_cache",
      ok: w1.ok && w2.ok && !w1.cache_hit && !w2.cache_hit && after === before,
      detail: `cache_total before=${before} after=${after} (should be equal) w1.ok=${w1.ok} w2.ok=${w2.ok}`,
    });
  } catch (e) {
    results.push({ name: "write_op_bypasses_cache", ok: false, detail: (e as Error).message });
  }

  // Cleanup.
  invalidateTool("memory");

  return NextResponse.json({
    cache_stats: stats(),
    all_ok: results.every((r) => r.ok),
    results,
  });
}
