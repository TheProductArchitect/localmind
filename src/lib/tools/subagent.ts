/**
 * spawn_subagent — the orchestration primitive that lets Sora (the main agent)
 * delegate a discrete sub-task to a child agent.
 *
 * Why this exists
 * ----------------
 * A user request like "research X, write a summary to ~/notes.md, then start a
 * coding task on the result" is THREE distinct units of work with different
 * tool needs (peer_knowledge / filesystem / pi_code). Without subagents the
 * main agent does all three serially in one giant tool-call sequence, losing
 * its conversational context to scratch work.
 *
 * With this tool, Sora can:
 *   1. Spawn a "research" subagent with peer_knowledge + web_search + knowledge_base
 *   2. Spawn a "writer" subagent with filesystem + memory
 *   3. Spawn a "code" subagent with pi_code
 *   ...and compose the three children's outputs in its own final reply.
 *
 * Each subagent runs a fresh agent loop in its own conversation. Tool calls
 * inside the subagent go through the LOCAL permission profile and audit chain
 * the same way as parent-agent calls — no special privileges are inherited.
 *
 * Safety
 * ------
 * - Recursion depth is capped at MAX_SUBAGENT_DEPTH (3). A subagent that's
 *   already at depth N can spawn children of depth N+1 but not deeper. Depth
 *   is tracked via a conversation metadata field, NOT trusted from the tool
 *   input (so a model can't lie about its depth to deepen the chain).
 * - Per-subagent timeout (default 3 minutes) bounds how long any single
 *   child can hold up the parent.
 * - Subagents see the full tool registry by default; the `allowed_tools`
 *   parameter narrows it for focused tasks. Empty/unset = full registry.
 *
 * Cost accounting
 * ---------------
 * Subagent tool calls audit independently in their own conversation. The
 * V6.7 tool-call cache applies to subagent calls too, so cached outputs
 * flow through cleanly. The parent's audit row for `spawn_subagent` records
 * the goal + child conversation id so an auditor can trace down.
 *
 * Serial vs parallel
 * ------------------
 * Two tools exist:
 *   - spawn_subagent           : single, await before next. Use when later
 *                                work depends on the result.
 *   - spawn_subagents_parallel : batch, runs with bounded concurrency capped
 *                                by the resource governor. Use when tasks are
 *                                independent.
 * Sora decides which based on whether the tasks have data dependencies. The
 * governor enforces the actual concurrency cap regardless of what Sora asks
 * for — Sora can request 8 parallel, the governor may permit only 2.
 */

// NOTE: agent/engine.ts is imported DYNAMICALLY inside execute() to avoid a
// circular import. The chain otherwise is:
//   tools/subagent.ts → agent/engine.ts → tools/index.ts → tools/subagent.ts
// which trips the temporal dead zone for spawnSubagentTool on first module load.
import { createConversation, getConversation } from "../db/queries";
import { getConvDb } from "../db";
import { listPersonas } from "../db/personas";
import { renderMemoryBlock } from "../db/agent-memory";
import type { Tool } from "./types";

const MAX_SUBAGENT_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 3 * 60_000;

/**
 * Conversation metadata isn't a first-class column, but we can stash subagent
 * depth in the conversation tags column (which is JSON). A bit of a hack —
 * a proper `metadata_json` column on conversations is a follow-up, but this
 * works without a schema migration.
 */
function readDepth(conversationId: string): number {
  try {
    const row = getConvDb()
      .prepare("SELECT tags FROM conversations WHERE id=?")
      .get(conversationId) as { tags: string } | undefined;
    if (!row) return 0;
    const tags = JSON.parse(row.tags || "[]") as string[];
    for (const t of tags) {
      const m = t.match(/^subagent_depth:(\d+)$/);
      if (m) return Number(m[1]);
    }
    return 0;
  } catch {
    return 0;
  }
}

function writeDepth(conversationId: string, depth: number): void {
  try {
    const row = getConvDb()
      .prepare("SELECT tags FROM conversations WHERE id=?")
      .get(conversationId) as { tags: string } | undefined;
    const tags = row ? (JSON.parse(row.tags || "[]") as string[]) : [];
    const filtered = tags.filter((t) => !t.startsWith("subagent_depth:"));
    filtered.push(`subagent_depth:${depth}`);
    getConvDb()
      .prepare("UPDATE conversations SET tags=? WHERE id=?")
      .run(JSON.stringify(filtered), conversationId);
  } catch {
    /* non-fatal */
  }
}

function buildSubagentSystemPrefix(args: {
  goal: string;
  persona_id?: string;
  persona_name?: string;
  allowed_tools?: string[];
  depth: number;
}): string {
  const toolList = args.allowed_tools && args.allowed_tools.length > 0
    ? args.allowed_tools.join(", ")
    : "(none granted)";
  const personaHint = args.persona_name ? ` Persona: ${args.persona_name}.` : "";
  const memoryBlock = args.persona_id ? renderMemoryBlock(args.persona_id) : "";

  return [
    `You are a subagent spawned by Sora to handle one focused task.${personaHint}`,
    `Subagent depth: ${args.depth} / ${MAX_SUBAGENT_DEPTH}.`,
    ...(memoryBlock ? [``, memoryBlock] : []),
    ``,
    `Goal:`,
    args.goal,
    ``,
    `TOOL SURFACE — these are the ONLY tools available to you on this run:`,
    `  ${toolList}`,
    `Tools outside this list are unavailable to you. Do not try to call them;`,
    `the engine will refuse and you'll waste a turn.`,
    ``,
    `If your task genuinely cannot be completed with these tools, call`,
    `request_tool_access with the specific tool names you need and a 1-2`,
    `sentence reason. That ends your run cleanly with a structured request the`,
    `parent (Sora) reads — she'll decide whether to grant + re-spawn you, do the`,
    `work herself, or tell the user we can't proceed. DO NOT call it for tools`,
    `you already have above, and DO NOT call it to bypass safety — destructive`,
    `actions need user confirmation regardless of who holds the tool.`,
    ``,
    `Your output is captured verbatim and handed back to the orchestrator —`,
    `do not include conversational preamble. State the result, briefly note`,
    `anything Sora needs to know about gaps or follow-ups, then stop.`,
  ].join("\n");
}

export const spawnSubagentTool: Tool = {
  // We classify this as `memory_write` because it's an active, irreversible
  // action (the subagent will make tool calls of its own — could touch files,
  // send messages, etc.). Treating it as a write keeps the permission gate
  // visible to users who set write_files to "ask first".
  actionType: "memory_write",
  classify: () => "memory_write",
  preview: (i) => {
    const goal = String(i.goal ?? "").slice(0, 120);
    const tools = Array.isArray(i.allowed_tools) && i.allowed_tools.length > 0
      ? ` with tools: ${(i.allowed_tools as string[]).join(", ")}`
      : "";
    return `Spawn subagent${tools}: ${goal}`;
  },
  version: "1",
  // Subagents do real work and shouldn't be cache-hit just because the goal
  // string matches a previous run — the world (filesystem, peers, etc.)
  // may have changed between calls.
  cacheable: () => false,
  definition: {
    name: "spawn_subagent",
    description:
      "Hand off a focused sub-task to a child agent with its own context and tool loop. Use when a request has distinct units that each deserve their own focused window. Returns the subagent's final text. Depth capped at 3.",
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description:
            "What the subagent should accomplish. Be specific — it only sees this goal, not your conversation.",
        },
        persona_id: {
          type: "string",
          description:
            "Optional persona id (e.g. 'persona-devpm' for code work). Defaults to the same persona as the orchestrator.",
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description:
            "Tool whitelist for this run. Narrower surface = sharper focus.",
        },
        timeout_seconds: {
          type: "number",
          description:
            "Maximum wall-clock seconds the subagent may run. Defaults to 180 (3 min). Caps at 600.",
        },
      },
      required: ["goal"],
    },
  },
  async execute(input, ctx) {
    const goal = String(input.goal ?? "").trim();
    if (!goal) return { ok: false, output: "goal is required" };

    // Depth check — read the PARENT conversation's depth. We trust the
    // conversation tag, not the input, so a misbehaving model can't claim
    // depth=0 to deepen the chain.
    const parentDepth = readDepth(ctx.conversationId);
    if (parentDepth >= MAX_SUBAGENT_DEPTH) {
      return {
        ok: false,
        output: `Refusing to spawn — already at subagent depth ${parentDepth} / ${MAX_SUBAGENT_DEPTH}. Handle the remaining work directly in this conversation.`,
      };
    }
    const childDepth = parentDepth + 1;

    // Look up the requested persona (or default to general). The persona
    // carries the BASE tool surface — what this kind of agent is allowed
    // to do in principle. The caller's allowed_tools narrows further.
    // Accept prompt aliases like persona-researcher → agent-researcher.
    let personaName: string | undefined;
    let personaTools: string[] | null = null;
    const rawPersonaId = String(input.persona_id ?? "persona-general");
    let effectivePersonaId = rawPersonaId;
    try {
      const personas = listPersonas();
      const lower = rawPersonaId.toLowerCase();
      const stem = lower.replace(/^(persona|agent)-/, "");
      const persona =
        personas.find((p) => p.persona_id === rawPersonaId) ||
        personas.find((p) => p.persona_id === `agent-${stem}`) ||
        personas.find((p) => p.persona_id === `persona-${stem}`) ||
        personas.find((p) => p.name.toLowerCase() === stem);
      if (persona) {
        effectivePersonaId = persona.persona_id;
        personaName = persona.name;
        try {
          const parsed = JSON.parse(persona.enabled_tools || "[]") as string[];
          if (Array.isArray(parsed) && parsed.length > 0) personaTools = parsed;
        } catch { /* persona has no whitelist — falls back to caller-only */ }
      }
    } catch { /* non-fatal — falls through to no-persona */ }

    // Bound the timeout. 5s minimum, 10min hard cap to prevent a runaway
    // child from holding up the parent indefinitely.
    const timeoutSeconds = Math.max(
      5,
      Math.min(600, typeof input.timeout_seconds === "number" ? input.timeout_seconds : 180)
    );

    // Spin up a fresh conversation for the subagent. The parent's owner is
    // inherited so the subagent inherits the same permission profile.
    const parentConv = getConversation(ctx.conversationId);
    const ownerUserId = parentConv?.owner_user_id ?? undefined;
    const subConv = createConversation(parentConv?.profile_id ?? undefined, ownerUserId);
    writeDepth(subConv.id, childDepth);

    // === Resolve the EFFECTIVE tool surface ===
    // Rules:
    //   • If the persona declares enabled_tools, that's the ceiling.
    //   • The caller-supplied allowed_tools further narrows (intersection).
    //   • If neither is set, the subagent gets a small safe default rather
    //     than the full registry — narrow surfaces produce focused agents.
    //   • request_tool_access is appended by the engine itself, so the
    //     subagent can always ask for more when stuck.
    const callerTools = Array.isArray(input.allowed_tools)
      ? (input.allowed_tools as string[]).filter((t) => typeof t === "string")
      : [];
    const SAFE_DEFAULT = [
      "memory",
      "time",
      "knowledge_base",
      "web_search",
      "web_research",
      "read_secure_webpage",
    ];

    let effectiveTools: string[];
    if (personaTools && callerTools.length > 0) {
      // Intersection — caller can only narrow, not broaden, the persona surface.
      const personaSet = new Set(personaTools);
      effectiveTools = callerTools.filter((t) => personaSet.has(t));
      if (effectiveTools.length === 0) {
        // Caller asked for something outside the persona's ceiling. Tell them
        // clearly rather than silently expanding or silently emptying.
        return {
          ok: false,
          output:
            `Refusing to spawn — none of the requested allowed_tools [${callerTools.join(", ")}] are in ${personaName ?? "persona"}'s enabled_tools. ` +
            `Either pick a persona that includes those tools, or drop allowed_tools to use the persona default (${personaTools.join(", ")}).`,
        };
      }
    } else if (personaTools) {
      effectiveTools = personaTools;
    } else if (callerTools.length > 0) {
      effectiveTools = callerTools;
    } else {
      effectiveTools = SAFE_DEFAULT;
    }

    const systemPrefix = buildSubagentSystemPrefix({
      goal,
      persona_id: effectivePersonaId,
      persona_name: personaName,
      allowed_tools: effectiveTools,
      depth: childDepth,
    });

    // Race the subagent against the configured timeout. Tag the spawned
    // agent_processes row with subagent metadata so the analytics rollup
    // (resource-governor.ts recentSubagentPerformance) can attribute and
    // measure this run.
    const { runAgentCollect } = await import("../agent/engine");
    const freeRamGbAtStart = Math.round((require("os").freemem() / 1024 ** 3) * 10) / 10;
    let output = "";
    let timedOut = false;
    await Promise.race([
      runAgentCollect(subConv.id, goal, {
        systemPrefix,
        processDisplayName: `Subagent: ${goal.slice(0, 60)}`,
        allowedTools: effectiveTools,
        processMetadata: {
          kind: "subagent",
          batch_size: 1,
          parent_conversation_id: ctx.conversationId,
          free_ram_gb_at_start: freeRamGbAtStart,
          depth: childDepth,
          allowed_tools: effectiveTools,
          persona_id: effectivePersonaId,
          persona_name: personaName ?? null,
        },
      }).then((text) => {
        output = text;
      }).catch((e) => {
        output = `(subagent error: ${(e as Error).message ?? "unknown"})`;
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => { timedOut = true; resolve(); }, timeoutSeconds * 1000)
      ),
    ]);

    if (timedOut && !output) {
      return {
        ok: false,
        output: `Subagent timed out after ${timeoutSeconds}s. Conversation id ${subConv.id} preserved for inspection.`,
        summary: JSON.stringify({
          kind: "subagent",
          conversation_id: subConv.id,
          persona: personaName ?? null,
          persona_id: effectivePersonaId,
          depth: childDepth,
          goal,
          allowed_tools: effectiveTools,
          timed_out: true,
        }),
      };
    }

    const safeOutput = (output || "(subagent produced no output)").slice(0, 16 * 1024);
    return {
      ok: true,
      output: safeOutput,
      // Machine-readable summary so the chat UI can show a high-level spawn
      // card and load child tool I/O on expand (conversation_id + persona).
      summary: JSON.stringify({
        kind: "subagent",
        conversation_id: subConv.id,
        persona: personaName ?? null,
        persona_id: effectivePersonaId,
        depth: childDepth,
        goal,
        allowed_tools: effectiveTools,
        timed_out: false,
      }),
    };
  },
};

// ---------------------------------------------------------------------------
// spawn_subagents_parallel — bounded-concurrency batch spawn.
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 8;

type BatchSpec = {
  goal: string;
  persona_id?: string;
  allowed_tools?: string[];
  timeout_seconds?: number;
};

type BatchResult = {
  goal: string;
  ok: boolean;
  output: string;
  duration_ms: number;
  conversation_id?: string;
  error?: string;
};

/**
 * Run `items` with at most `limit` in-flight at once. Preserves order in the
 * returned array — element i corresponds to items[i]. Errors are captured in
 * the result, not thrown, so one bad subagent doesn't kill the batch.
 */
async function bounded<T>(items: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let cursor = 0;
  const errSentinel = Symbol("err");

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await items[i]();
      } catch (e) {
        // Caller distinguishes failure from success via the result struct,
        // so we don't propagate.
        (out as Array<T | { _err: unknown; sentinel: typeof errSentinel }>)[i] = {
          _err: e,
          sentinel: errSentinel,
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

export const spawnSubagentsParallelTool: Tool = {
  actionType: "memory_write",
  classify: () => "memory_write",
  preview: (i) => {
    const batch = Array.isArray(i.batch) ? (i.batch as BatchSpec[]) : [];
    const n = batch.length;
    return `Spawn ${n} subagent${n === 1 ? "" : "s"} in parallel (governor will cap)`;
  },
  version: "1",
  cacheable: () => false,
  definition: {
    name: "spawn_subagents_parallel",
    description:
      "Spawn a batch of independent subagents in parallel. Concurrency is capped by the resource governor — you ask, it decides. Returns results in input order. Use spawn_subagent sequentially if B needs A's output.",
    parameters: {
      type: "object",
      properties: {
        batch: {
          type: "array",
          maxItems: MAX_BATCH_SIZE,
          description: `Array of subagent specs (max ${MAX_BATCH_SIZE}). Each spec is {goal, persona_id?, allowed_tools?, timeout_seconds?}.`,
          items: {
            type: "object",
            properties: {
              goal: { type: "string" },
              persona_id: { type: "string" },
              allowed_tools: { type: "array", items: { type: "string" } },
              timeout_seconds: { type: "number" },
            },
            required: ["goal"],
          },
        },
        max_parallel: {
          type: "number",
          description: "Requested max concurrency. Governor may cap lower; actual is in cap_applied.",
        },
      },
      required: ["batch"],
    },
  },
  async execute(input, ctx) {
    const batch = (Array.isArray(input.batch) ? input.batch : []) as BatchSpec[];
    if (batch.length === 0) {
      return { ok: false, output: "batch is required and must contain at least one subagent spec" };
    }
    if (batch.length > MAX_BATCH_SIZE) {
      return { ok: false, output: `batch size ${batch.length} exceeds the maximum of ${MAX_BATCH_SIZE}. Plan in waves.` };
    }
    for (let i = 0; i < batch.length; i++) {
      if (!batch[i] || typeof batch[i].goal !== "string" || !batch[i].goal.trim()) {
        return { ok: false, output: `batch[${i}].goal is required and must be a non-empty string` };
      }
    }

    // Depth check — same logic as the single-spawn variant.
    const parentDepth = readDepth(ctx.conversationId);
    if (parentDepth >= MAX_SUBAGENT_DEPTH) {
      return {
        ok: false,
        output: `Refusing to spawn — already at subagent depth ${parentDepth} / ${MAX_SUBAGENT_DEPTH}.`,
      };
    }
    const childDepth = parentDepth + 1;

    // V6.9: the governor's number is ADVICE, not enforcement. Sora can
    // overrule the advisory based on recent performance (e.g. she's seen
    // batches of 4 succeed on this hardware, so she ignores the RAM-pressure
    // 1-cap and tries 4). The only hard limit is SANITY_CEILING to prevent a
    // confused model from spawning hundreds.
    const { decideCapacity, SANITY_CEILING } = await import("../agent/resource-governor");
    const requested = typeof input.max_parallel === "number" ? Math.max(1, input.max_parallel) : batch.length;
    const decision = await decideCapacity(Math.min(requested, batch.length));
    const cap = Math.min(requested, batch.length, SANITY_CEILING);
    const advisoryDelta = cap - decision.max_concurrent;

    // Pre-resolve persona names (cheap lookup; same as single-spawn).
    const personas = listPersonas();
    function personaNameFor(id: string | undefined): string | undefined {
      if (!id) return undefined;
      return personas.find((p) => p.persona_id === id)?.name;
    }

    const parentConv = getConversation(ctx.conversationId);
    const ownerUserId = parentConv?.owner_user_id ?? undefined;

    // Build the per-item runner closures. Each is independent; bounded()
    // picks them up in order with up to `cap` in flight at once.
    // Resolve runAgentCollect once for the whole batch (dynamic import to
    // sidestep the circular dependency described at the top of this file).
    const { runAgentCollect } = await import("../agent/engine");

    const runners: Array<() => Promise<BatchResult>> = batch.map((spec) => {
      return async () => {
        const t0 = Date.now();
        const timeoutSeconds = Math.max(
          5,
          Math.min(600, typeof spec.timeout_seconds === "number" ? spec.timeout_seconds : 180)
        );

        const subConv = createConversation(parentConv?.profile_id ?? undefined, ownerUserId);
        writeDepth(subConv.id, childDepth);

        const personaName = personaNameFor(spec.persona_id);
        // Persona ceiling ∩ caller request, same as the single-spawn path.
        const personaObj = personas.find((p) => p.persona_id === spec.persona_id);
        let personaTools: string[] | null = null;
        if (personaObj) {
          try {
            const parsed = JSON.parse(personaObj.enabled_tools || "[]") as string[];
            if (Array.isArray(parsed) && parsed.length > 0) personaTools = parsed;
          } catch { /* persona has no whitelist */ }
        }
        const callerTools = spec.allowed_tools && spec.allowed_tools.length > 0 ? spec.allowed_tools : [];
        const SAFE_DEFAULT = ["memory", "time", "knowledge_base", "web_search"];
        let effectiveTools: string[];
        if (personaTools && callerTools.length > 0) {
          const personaSet = new Set(personaTools);
          effectiveTools = callerTools.filter((t) => personaSet.has(t));
          if (effectiveTools.length === 0) effectiveTools = personaTools;
        } else if (personaTools) effectiveTools = personaTools;
        else if (callerTools.length > 0) effectiveTools = callerTools;
        else effectiveTools = SAFE_DEFAULT;

        const systemPrefix = buildSubagentSystemPrefix({
          goal: spec.goal,
          persona_id: spec.persona_id,
          persona_name: personaName,
          allowed_tools: effectiveTools,
          depth: childDepth,
        });

        const freeRamGbAtStart = Math.round((require("os").freemem() / 1024 ** 3) * 10) / 10;
        let output = "";
        let timedOut = false;
        await Promise.race([
          runAgentCollect(subConv.id, spec.goal, {
            systemPrefix,
            processDisplayName: `Subagent: ${spec.goal.slice(0, 60)}`,
            allowedTools: effectiveTools,
            processMetadata: {
              kind: "subagent",
              batch_size: batch.length,
              parent_conversation_id: ctx.conversationId,
              free_ram_gb_at_start: freeRamGbAtStart,
              depth: childDepth,
              cap_applied: cap,
              allowed_tools: effectiveTools,
              persona_id: spec.persona_id ?? null,
              persona_name: personaName ?? null,
            },
          }).then((text) => {
            output = text;
          }).catch((e) => {
            output = `(subagent error: ${(e as Error).message ?? "unknown"})`;
          }),
          new Promise<void>((resolve) =>
            setTimeout(() => { timedOut = true; resolve(); }, timeoutSeconds * 1000)
          ),
        ]);

        const duration = Date.now() - t0;
        if (timedOut && !output) {
          return {
            goal: spec.goal,
            ok: false,
            output: `Subagent timed out after ${timeoutSeconds}s`,
            duration_ms: duration,
            conversation_id: subConv.id,
            error: "timeout",
          };
        }
        return {
          goal: spec.goal,
          ok: true,
          output: (output || "(no output)").slice(0, 8 * 1024),
          duration_ms: duration,
          conversation_id: subConv.id,
        };
      };
    });

    const t0 = Date.now();
    const results = await bounded(runners, cap);
    const totalMs = Date.now() - t0;

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // Format the output as a compact human-readable digest. Sora's next turn
    // gets this back as the tool result.
    const lines: string[] = [];
    lines.push(
      `Batch of ${results.length} subagent(s) complete in ${totalMs}ms (cap=${cap}, requested=${requested}, governor=${decision.max_concurrent})`
    );
    if (decision.warnings.length > 0) {
      lines.push(`Governor warnings: ${decision.warnings.join("; ")}`);
    }
    lines.push("");
    results.forEach((r, i) => {
      lines.push(`--- [${i + 1}/${results.length}] ${r.ok ? "OK" : "FAILED"} (${r.duration_ms}ms) ---`);
      lines.push(`goal: ${r.goal.slice(0, 200)}`);
      lines.push(r.output);
      lines.push("");
    });

    return {
      ok: failCount === 0,
      output: lines.join("\n").slice(0, 64 * 1024),
      summary: `${okCount}/${results.length} subagent(s) succeeded; cap=${cap}, total=${totalMs}ms`,
    };
  },
};

/** Exported for the self-test only. */
export const __test_internals = { bounded };

