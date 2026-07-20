/**
 * Text tool-call recovery.
 *
 * Small local models frequently "narrate" a tool call as raw JSON in their
 * text response instead of emitting a structured tool call — e.g.
 *   {"name": "pi_code", "parameters": {...}}
 *   Here's a JSON object for a function call: {"name": "scheduler", ...}
 * When that happens the intended action never runs and the JSON leaks to the
 * user. This module detects such a message and turns it back into a real tool
 * call, which the engine then runs through the SAME permission guard +
 * confirmation + audit path (so nothing is executed unsupervised).
 *
 * Pure + dependency-free so it's trivially unit-tested.
 */

export type RecoveredCall = { id: string; name: string; arguments: Record<string, unknown> };

/** Extract every balanced top-level {...} / [...] JSON snippet from a string. */
export function extractJsonSnippets(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" || c === "]") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/** Index of the bracket that balances the one at `start`, or -1. */
function scanBalanced(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Repair the "quote-wrapped JSON value with unescaped inner quotes" pattern
 * some models emit when narrating a tool call, e.g.
 *   {"batch": "[{"goal": "Find jobs"}]"}
 * The wrapping quotes make the whole snippet unparseable. When the wrapped
 * fragment is itself valid JSON, stripping the wrapper is a lossless fix:
 *   {"batch": [{"goal": "Find jobs"}]}
 * Properly-escaped stringified values (\" inside) fail the inner JSON.parse
 * guard and are left untouched.
 *
 * Also handles truncated wrappers where the model forgot the closing `]` —
 * we append missing closers and accept the fragment if that makes it parse.
 */
export function repairStringWrappedJson(text: string): string {
  let result = text;
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i] !== '"') continue;
      const open = result[i + 1];
      if (open !== "[" && open !== "{") continue;
      // Must be in value position: previous non-space char is ':'.
      let p = i - 1;
      while (p >= 0 && /\s/.test(result[p])) p--;
      if (p < 0 || result[p] !== ":") continue;

      let end = scanBalanced(result, i + 1);
      let fragment: string | null = null;

      if (end >= 0 && result[end + 1] === '"') {
        fragment = result.slice(i + 1, end + 1);
        try { JSON.parse(fragment); } catch { fragment = null; }
      }

      // Truncated wrap: model closed the quote before closing ] / }.
      // Find the closing `"` of the fake string (followed by `,` or `}`).
      if (!fragment) {
        let q = -1;
        for (let j = i + 1; j < result.length; j++) {
          if (result[j] === '"' && result[j - 1] !== "\\") {
            if (/^\s*[,}]/.test(result.slice(j + 1))) { q = j; break; }
          }
        }
        if (q > i + 1) {
          const raw = result.slice(i + 1, q);
          fragment = tryCloseJson(raw);
          if (fragment) {
            result = result.slice(0, i) + fragment + result.slice(q + 1);
            changed = true;
            break;
          }
        }
      } else {
        result = result.slice(0, i) + fragment + result.slice(end! + 2);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return result;
}

/** If `raw` is almost-JSON missing trailing closers, append them and parse. */
function tryCloseJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const attempts = [trimmed];
  // Count unmatched openers (naive, string-aware enough for our cases).
  let depthObj = 0;
  let depthArr = 0;
  let inStr = false;
  let esc = false;
  for (const c of trimmed) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depthObj++;
    else if (c === "}") depthObj--;
    else if (c === "[") depthArr++;
    else if (c === "]") depthArr--;
  }
  if (depthObj > 0 || depthArr > 0) {
    attempts.push(trimmed + "}".repeat(Math.max(0, depthObj)) + "]".repeat(Math.max(0, depthArr)));
    attempts.push(trimmed + "]".repeat(Math.max(0, depthArr)) + "}".repeat(Math.max(0, depthObj)));
  }
  for (const a of attempts) {
    try {
      JSON.parse(a);
      return a;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Last-resort recovery when the narrated JSON is too mangled for JSON.parse —
 * e.g. truncated arrays, Python-style lists inside strings. Pulls out a known
 * spawn tool name + any `"goal": "..."` specs so the intended batch still runs.
 */
export function recoverLooseSpawnCall(
  text: string,
  isKnownTool: (name: string) => boolean
): RecoveredCall | null {
  const nameMatch = text.match(
    /"name"\s*:\s*"(spawn_subagents_parallel|spawn_subagents_sequential|spawn_subagent)"/i
  );
  if (!nameMatch) return null;
  let name = nameMatch[1];
  if (!isKnownTool(name)) return null;

  // User asked for sequential / one-then-next — honour that even if the model
  // narrated the parallel tool name.
  const wantsSequential =
    /\bsequential(ly)?\b|\bone\s+at\s+a\s+time\b|\bone\s+(?:agent|subagent)\b[\s\S]{0,40}\bthen\b|\bthen\s+(?:the\s+)?next\b/i.test(
      text
    );
  if (wantsSequential && name === "spawn_subagents_parallel" && isKnownTool("spawn_subagents_sequential")) {
    name = "spawn_subagents_sequential";
  }

  const goals = [...text.matchAll(/"goal"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
  );
  if (goals.length === 0) return null;

  // Optional per-spec fields: take the first occurrence near each goal when
  // present; otherwise leave defaults for the tool to fill.
  const personaMatches = [...text.matchAll(/"persona_id"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const timeoutMatches = [...text.matchAll(/"timeout_seconds"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  const toolsMatches = [...text.matchAll(/"allowed_tools"\s*:\s*("(?:[^"\\]|\\.)*"|\[)/g)];

  const batch = goals.map((goal, i) => {
    const spec: Record<string, unknown> = { goal };
    if (personaMatches[i]) spec.persona_id = personaMatches[i];
    if (timeoutMatches[i] != null) spec.timeout_seconds = timeoutMatches[i];
    const toolsRaw = toolsMatches[i]?.[1];
    if (toolsRaw) {
      const tools = coerceStringList(toolsRaw.startsWith("[") ? extractListNear(text, toolsMatches[i].index!) : toolsRaw.slice(1, -1));
      if (tools?.length) spec.allowed_tools = tools;
    }
    return spec;
  });

  return {
    id: `text-call-loose-${Date.now().toString(36)}`,
    name,
    arguments: { batch },
  };
}

/** Pull a `[...]` list starting at `from` (index of `"` before `[` or of `[`). */
function extractListNear(text: string, from: number): string {
  const bracket = text.indexOf("[", from);
  if (bracket < 0) return "[]";
  const end = scanBalanced(text, bracket);
  return end >= 0 ? text.slice(bracket, end + 1) : "[]";
}

/** Parse JSON arrays, or Python-ish `"['a', 'b']"` / `['a', 'b']` strings. */
export function coerceStringList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch { /* fall through */ }
  // Python / single-quoted list: ['a', 'b'] or "['a', 'b']"
  const unquoted = s.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").trim();
  const m = unquoted.match(/^\[(.*)\]$/s);
  if (!m) return undefined;
  return m[1]
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

// Common names small models invent for real tools. Mapped to the canonical
// tool so an attempted call still lands (still gated by the permission guard).
const ALIASES: Record<string, string> = {
  scheduler: "schedule_task",
  schedule: "schedule_task",
  reminder: "schedule_task",
  remind: "schedule_task",
  set_reminder: "schedule_task",
  research: "web_research",
  search: "web_search",
  websearch: "web_search",
  spawn: "spawn_subagent",
  spawn_agent: "spawn_subagent",
  spawn_agents: "spawn_subagents_sequential",
  spawn_sequential: "spawn_subagents_sequential",
  spawn_agents_sequential: "spawn_subagents_sequential",
  spawn_parallel: "spawn_subagents_parallel",
  spawn_agents_parallel: "spawn_subagents_parallel",
};

function coerceName(item: any): string | null {
  const n = item?.name ?? item?.tool ?? item?.tool_name ?? item?.function ?? item?.function?.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/** Resolve a possibly-aliased name to a canonical known tool, or null. */
function resolveCanonical(name: string, isKnownTool: (name: string) => boolean): string | null {
  if (isKnownTool(name)) return name;
  const alias = ALIASES[name.toLowerCase()];
  if (alias && isKnownTool(alias)) return alias;
  return null;
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  if (typeof out.batch === "string") {
    try {
      out.batch = JSON.parse(out.batch as string);
    } catch {
      const closed = tryCloseJson(out.batch as string);
      if (closed) {
        try { out.batch = JSON.parse(closed); } catch { /* leave as-is */ }
      }
    }
  }
  if (Array.isArray(out.batch)) {
    out.batch = (out.batch as Record<string, unknown>[]).map((spec) => {
      if (!spec || typeof spec !== "object") return spec;
      const next = { ...spec };
      if (next.allowed_tools != null && !Array.isArray(next.allowed_tools)) {
        const tools = coerceStringList(next.allowed_tools);
        if (tools) next.allowed_tools = tools;
      }
      return next;
    });
  }
  return out;
}

function coerceArgs(item: any): Record<string, unknown> {
  const a = item?.parameters ?? item?.arguments ?? item?.input ?? item?.args ?? item?.function?.arguments ?? {};
  if (typeof a === "string") {
    try { return normalizeArgs(JSON.parse(a)); } catch { return {}; }
  }
  return a && typeof a === "object" ? normalizeArgs(a) : {};
}

function preferSequentialIfAsked(text: string, calls: RecoveredCall[], isKnownTool: (n: string) => boolean): RecoveredCall[] {
  const wantsSequential =
    /\bsequential(ly)?\b|\bone\s+at\s+a\s+time\b|\bone\s+(?:agent|subagent)\b[\s\S]{0,40}\bthen\b|\bthen\s+(?:the\s+)?next\b/i.test(
      text
    );
  if (!wantsSequential || !isKnownTool("spawn_subagents_sequential")) return calls;
  return calls.map((c) =>
    c.name === "spawn_subagents_parallel" ? { ...c, name: "spawn_subagents_sequential" } : c
  );
}

function parseOnce(cleaned: string, isKnownTool: (name: string) => boolean): RecoveredCall[] {
  const calls: RecoveredCall[] = [];
  for (const snippet of extractJsonSnippets(cleaned)) {
    let parsed: unknown;
    try { parsed = JSON.parse(snippet); } catch { continue; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const raw = coerceName(item);
      if (!raw) continue;
      const name = resolveCanonical(raw, isKnownTool);
      if (!name) continue;
      calls.push({ id: `text-call-${calls.length}-${Date.now().toString(36)}`, name, arguments: coerceArgs(item) });
    }
  }
  return calls;
}

/**
 * Parse tool calls a model emitted as text. Only returns calls whose name is a
 * known tool (via `isKnownTool`) — a strong signal the JSON is an attempted
 * invocation rather than an illustrative example. Handles code fences, a single
 * object, arrays of calls, a leading prose preamble, malformed quote-wrapped
 * JSON values, and (last resort) loose spawn-batch recovery from mangled text.
 */
export function parseTextToolCalls(text: string, isKnownTool: (name: string) => boolean): RecoveredCall[] {
  if (!text || !text.trim()) return [];
  const cleaned = text.replace(/```(?:json|tool_call)?/gi, "");
  let calls = parseOnce(cleaned, isKnownTool);
  if (calls.length === 0) {
    const repaired = repairStringWrappedJson(cleaned);
    if (repaired !== cleaned) calls = parseOnce(repaired, isKnownTool);
  }
  if (calls.length === 0) {
    const loose = recoverLooseSpawnCall(cleaned, isKnownTool);
    if (loose) calls = [loose];
  }
  return preferSequentialIfAsked(cleaned, calls, isKnownTool);
}
