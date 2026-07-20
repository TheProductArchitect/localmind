/**
 * Spawn intent compiler — normalize small-model spawn args into a single mode.
 *
 * Small models struggle to pick among spawn_subagent / sequential / parallel.
 * `spawn_agents` accepts a loose shape and this module decides:
 *   - explicit mode wins
 *   - one goal → single
 *   - prose asks sequential → sequential
 *   - prose asks parallel → parallel
 *   - default multi-unit → sequential (spare RAM)
 */

export type BatchSpec = {
  goal: string;
  persona_id?: string;
  allowed_tools?: string[];
  timeout_seconds?: number;
};

export type SpawnIntent = {
  mode: "single" | "sequential" | "parallel";
  batch: BatchSpec[];
  max_parallel?: number;
  reason: string;
};

const MAX_BATCH_SIZE = 8;

export function wantsSequentialProse(text: string): boolean {
  return /\bsequential(ly)?\b|\bone\s+at\s+a\s+time\b|\bone\s+(?:agent|subagent)\b[\s\S]{0,40}\bthen\b|\bthen\s+(?:the\s+)?next\b/i.test(
    text
  );
}

export function wantsParallelProse(text: string): boolean {
  return /\bparallel(ly)?\b|\bat\s+once\b|\bsimultaneously\b|\ball\s+at\s+the\s+same\s+time\b|\bin\s+parallel\b/i.test(
    text
  );
}

function coerceBatch(input: Record<string, unknown>): BatchSpec[] {
  let rawBatch: unknown = input.batch;
  if (typeof rawBatch === "string") {
    try {
      rawBatch = JSON.parse(rawBatch);
    } catch {
      rawBatch = [];
    }
  }
  if (Array.isArray(rawBatch) && rawBatch.length > 0) {
    return (rawBatch as Record<string, unknown>[])
      .map((spec) => ({
        goal: String(spec?.goal ?? "").trim(),
        persona_id: typeof spec?.persona_id === "string" ? spec.persona_id : undefined,
        allowed_tools: Array.isArray(spec?.allowed_tools)
          ? (spec.allowed_tools as string[]).filter((t) => typeof t === "string")
          : undefined,
        timeout_seconds:
          typeof spec?.timeout_seconds === "number" ? spec.timeout_seconds : undefined,
      }))
      .filter((s) => s.goal.length > 0)
      .slice(0, MAX_BATCH_SIZE);
  }
  const goal = String(input.goal ?? "").trim();
  if (goal) {
    return [
      {
        goal,
        persona_id: typeof input.persona_id === "string" ? input.persona_id : undefined,
        allowed_tools: Array.isArray(input.allowed_tools)
          ? (input.allowed_tools as string[]).filter((t) => typeof t === "string")
          : undefined,
        timeout_seconds:
          typeof input.timeout_seconds === "number" ? input.timeout_seconds : undefined,
      },
    ];
  }
  return [];
}

export function compileSpawnIntent(
  input: Record<string, unknown>,
  opts?: { userText?: string }
): SpawnIntent {
  const batch = coerceBatch(input);
  const userText = opts?.userText || String(input.intent || input.reason || "");

  const explicit = typeof input.mode === "string" ? input.mode.toLowerCase() : "";
  if (explicit === "single" || explicit === "sequential" || explicit === "parallel") {
    if (batch.length <= 1) {
      return {
        mode: "single",
        batch,
        reason: `explicit mode=${explicit}`,
      };
    }
    const mode = explicit === "single" ? "sequential" : (explicit as "sequential" | "parallel");
    return {
      mode,
      batch,
      max_parallel: typeof input.max_parallel === "number" ? input.max_parallel : undefined,
      reason: `explicit mode=${explicit}`,
    };
  }

  if (batch.length === 0) {
    return { mode: "single", batch: [], reason: "empty" };
  }
  if (batch.length === 1) {
    return { mode: "single", batch, reason: "single goal" };
  }
  if (wantsSequentialProse(userText)) {
    return { mode: "sequential", batch, reason: "prose sequential" };
  }
  if (wantsParallelProse(userText)) {
    return {
      mode: "parallel",
      batch,
      max_parallel: typeof input.max_parallel === "number" ? input.max_parallel : undefined,
      reason: "prose parallel",
    };
  }
  return { mode: "sequential", batch, reason: "default multi-unit sequential" };
}
