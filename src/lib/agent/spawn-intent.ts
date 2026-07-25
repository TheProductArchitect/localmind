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

function topLevelTools(input: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(input.allowed_tools)) return undefined;
  const tools = (input.allowed_tools as unknown[]).filter((t): t is string => typeof t === "string");
  return tools.length ? tools : undefined;
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
  // Top-level fields apply to every batch item that doesn't override them —
  // small models often put timeout / tools / persona once on the parent call.
  const inheritPersona =
    typeof input.persona_id === "string" ? input.persona_id : undefined;
  const inheritTools = topLevelTools(input);
  const inheritTimeout =
    typeof input.timeout_seconds === "number" ? input.timeout_seconds : undefined;

  if (Array.isArray(rawBatch) && rawBatch.length > 0) {
    return (rawBatch as Record<string, unknown>[])
      .map((spec) => ({
        goal: String(spec?.goal ?? "").trim(),
        persona_id:
          typeof spec?.persona_id === "string" ? spec.persona_id : inheritPersona,
        allowed_tools: Array.isArray(spec?.allowed_tools)
          ? (spec.allowed_tools as string[]).filter((t) => typeof t === "string")
          : inheritTools,
        timeout_seconds:
          typeof spec?.timeout_seconds === "number"
            ? spec.timeout_seconds
            : inheritTimeout,
      }))
      .filter((s) => s.goal.length > 0)
      .slice(0, MAX_BATCH_SIZE);
  }
  const goal = String(input.goal ?? "").trim();
  if (goal) {
    return [
      {
        goal,
        persona_id: inheritPersona,
        allowed_tools: inheritTools,
        timeout_seconds: inheritTimeout,
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

const DEFAULT_CHILD_TIMEOUT_S = 180;
const MAX_CHILD_TIMEOUT_S = 600;
/** Hard ceiling on how long the parent tool may wait for a whole spawn. */
const MAX_SPAWN_WALL_S = 20 * 60;

/**
 * Wall-clock budget for the outer `spawn_*` tool call. Sequential batches sum
 * child timeouts; parallel batches take the max. Without this the agent engine
 * would kill the spawn at the default 30s tool ceiling.
 */
export function spawnToolTimeoutMs(
  input: Record<string, unknown>,
  opts?: { userText?: string }
): number {
  const intent = compileSpawnIntent(input, opts);
  if (intent.batch.length === 0) {
    return (DEFAULT_CHILD_TIMEOUT_S + 30) * 1000;
  }
  const childSecs = intent.batch.map((spec) =>
    Math.max(
      5,
      Math.min(
        MAX_CHILD_TIMEOUT_S,
        typeof spec.timeout_seconds === "number"
          ? spec.timeout_seconds
          : DEFAULT_CHILD_TIMEOUT_S
      )
    )
  );
  const workSecs =
    intent.mode === "parallel" ? Math.max(...childSecs) : childSecs.reduce((a, b) => a + b, 0);
  // Setup / teardown overhead between children.
  const overhead = 30 + intent.batch.length * 5;
  return Math.min(MAX_SPAWN_WALL_S, workSecs + overhead) * 1000;
}
