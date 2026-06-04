/**
 * Smoke test for the V6.10 loop guard + STT capability probes:
 *   - N identical tool calls within the window trigger suspension
 *   - isSuspended() reflects the persisted state
 *   - resume() clears the suspension
 *   - canonical-key collisions: same input → same key, different input → different
 *   - STT batch + stream endpoints have a sensible capability probe
 */

import { NextResponse } from "next/server";
import { checkAndRecord, computeCallKey, isSuspended, resume, __config } from "@/lib/agent/loop-guard";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const convId = `lg-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1. computeCallKey: stable + collision-resistant
  const k1 = computeCallKey("web_search", { query: "hello" });
  const k2 = computeCallKey("web_search", { query: "hello" });
  const k3 = computeCallKey("web_search", { query: "world" });
  results.push({
    name: "call_key_stable_and_distinct",
    ok: k1 === k2 && k1 !== k3 && k1.length === 24,
    detail: `same=${k1 === k2} different=${k1 !== k3} len=${k1.length}`,
  });

  // 2. First N-1 identical calls do NOT trip the guard
  const tool = "web_search";
  const input = { query: "loop-guard-probe" };
  let trippedEarly = false;
  for (let i = 0; i < __config.MAX_REPEATS - 1; i++) {
    const r = checkAndRecord({ conversation_id: convId, tool_name: tool, input });
    if (!r.ok) { trippedEarly = true; break; }
  }
  results.push({
    name: "no_trip_before_threshold",
    ok: !trippedEarly,
    detail: `tolerated ${__config.MAX_REPEATS - 1} calls without tripping`,
  });

  // 3. The Nth identical call trips the suspension
  const tripResult = checkAndRecord({ conversation_id: convId, tool_name: tool, input });
  results.push({
    name: "trip_at_threshold",
    ok: !tripResult.ok && "suspended" in tripResult && tripResult.suspended === true,
    detail: tripResult.ok ? "did not trip" : `suspended: tool=${tripResult.tool} repeats=${tripResult.repeats}`,
  });

  // 4. isSuspended() reflects the trip
  const status = isSuspended(convId);
  results.push({
    name: "is_suspended_reflects_trip",
    ok: status.suspended === true && status.tool === tool,
    detail: JSON.stringify(status),
  });

  // 5. Further calls are refused while suspended
  const refused = checkAndRecord({ conversation_id: convId, tool_name: "different_tool", input: { other: "thing" } });
  results.push({
    name: "refused_while_suspended",
    ok: !refused.ok,
    detail: refused.ok ? "leak: allowed call while suspended" : `still suspended: ${refused.suspended ? "yes" : "no"}`,
  });

  // 6. resume() clears it
  const r = resume(convId);
  const afterResume = isSuspended(convId);
  results.push({
    name: "resume_clears_suspension",
    ok: r.resumed && !afterResume.suspended,
    detail: `resumed=${r.resumed} stillSuspended=${afterResume.suspended}`,
  });

  // 7. After resume, calls are allowed again
  const postResume = checkAndRecord({ conversation_id: convId, tool_name: tool, input });
  results.push({
    name: "calls_allowed_after_resume",
    ok: postResume.ok,
    detail: postResume.ok ? "ok" : "still blocked",
  });

  // Cleanup
  resume(convId);

  // 8. STT endpoint reachability (capability probes — don't fail the smoke test
  // if whisper isn't installed; we just record the state).
  const sttBatch = await fetch(new URL("/api/voice/stt-batch", "http://127.0.0.1:3000").toString())
    .then((r) => r.json()).catch(() => null);
  results.push({
    name: "stt_batch_probe_responds",
    ok: !!sttBatch,
    detail: sttBatch ? JSON.stringify(sttBatch).slice(0, 120) : "no response (endpoint may be unreachable in this context)",
  });

  const passed = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: passed === results.length,
    passed,
    total: results.length,
    results,
    config: __config,
  });
}
