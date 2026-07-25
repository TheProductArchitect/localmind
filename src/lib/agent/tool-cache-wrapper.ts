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
import { resolveWorkspaceRelayPeer } from "../fleet/workspace-route";
import { relayWorkspaceToolToPeer } from "../fleet/workspace-relay-initiator";
import { mirrorRemoteCodingSession } from "../fleet/workspace-session-mirror";
import { getToolHome, isToolRelayInbound } from "../fleet/tool-relay-context";
import { TOOL_RELAY_TOOLS } from "../fleet/handlers/tool-relay";
import { relayToolToPeer } from "../fleet/tool-relay-initiator";

const MAX_CACHE_OUTPUT_BYTES = 64 * 1024;
const CACHE_HIT_PREFIX = "[cache-hit] ";

export type CachedToolResult = ToolResult & {
  cache_hit?: boolean;
  cache_age_ms?: number;
  workspace_relay?: boolean;
};

export async function executeWithCache(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<CachedToolResult> {
  const toolName = tool.definition.name;

  // Tool home = initiator: when the model is running here on behalf of a peer
  // (inbound chat-relay whose tool_home points back at the initiator), run
  // allowlisted personal-assistant tools on THEIR device instead of ours.
  const toolHome = getToolHome();
  if (toolHome && !isToolRelayInbound()) {
    // Under tool-home=initiator, shell must not silently run on the compute
    // hub — it is intentionally excluded from TOOL_RELAY_TOOLS. Fail closed
    // with a clear message rather than executing on the wrong machine.
    if (toolName === "shell") {
      return {
        ok: false,
        output:
          "shell is not available when Tools are set to run on the initiating device. Use filesystem / browser / calendar / email (or switch Tools to the compute peer).",
        summary: "shell blocked under tool-home=initiator",
      };
    }
    if (TOOL_RELAY_TOOLS.has(toolName)) {
      const relayed = await relayToolToPeer({
        peer_node_id: toolHome.initiatorNodeId,
        tool: toolName,
        input,
        // Prefer the initiator's conversation id (ALS) over the executor twin.
        conversation_id: toolHome.conversationId ?? ctx.conversationId,
      });
      if (!relayed.ok) {
        return {
          ok: false,
          output: relayed.output || relayed.reason || "Tool relay to your device failed.",
          summary: "tool-relay failed",
        };
      }
      return { ok: true, output: relayed.output, summary: relayed.summary };
    }
  }

  const workspacePeer = resolveWorkspaceRelayPeer(toolName, input, ctx);
  if (workspacePeer) {
    // Force remote start_session without nested SWE on the workspace host —
    // compute peer owns the SWE loop after mirroring.
    const relayInput =
      toolName === "coding_project" && input.operation === "start_session"
        ? { ...input, run_swe: false }
        : input;
    const relayed = await relayWorkspaceToolToPeer({
      peer_node_id: workspacePeer,
      tool: toolName,
      input: relayInput,
      conversation_id: ctx.conversationId,
      coding_session_id: ctx.codingSessionId || (typeof input.coding_session_id === "string" ? input.coding_session_id : null),
    });
    if (!relayed.ok) {
      return {
        ok: false,
        output: relayed.reason || relayed.output || "Workspace relay failed.",
        summary: "workspace-relay failed",
        workspace_relay: true,
      };
    }
    if (toolName === "coding_project" && input.operation === "start_session" && relayed.summary) {
      await mirrorRemoteCodingSession({
        peerNodeId: workspacePeer,
        remoteSessionId: relayed.summary,
        conversationId: ctx.conversationId,
        goal: typeof input.goal === "string" ? input.goal : "",
        projectId: typeof input.project_id === "string" ? input.project_id : "",
        runSwe: input.run_swe !== false && input.run_swe !== "false",
      }).catch(() => null);
    }
    if (toolName === "coding_project" && input.operation === "discard_session") {
      const sid = typeof input.session_id === "string" ? input.session_id : "";
      if (sid) {
        try {
          const { updateCodingSession } = await import("../db/coding");
          updateCodingSession(sid, { status: "discarded" });
        } catch { /* ignore */ }
      }
    }
    return {
      ok: true,
      output: relayed.output,
      summary: relayed.summary,
      workspace_relay: true,
    };
  }

  const eligible = typeof tool.cacheable === "function" ? tool.cacheable(input) : false;
  if (!eligible) {
    return tool.execute(input, ctx);
  }

  const toolVersion = tool.version ?? "1";
  const inputHash = computeToolInputHash(input);

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
