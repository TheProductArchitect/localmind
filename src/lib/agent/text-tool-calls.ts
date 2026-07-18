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
  spawn_agents: "spawn_subagents_parallel",
  spawn_parallel: "spawn_subagents_parallel",
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

function coerceArgs(item: any): Record<string, unknown> {
  const a = item?.parameters ?? item?.arguments ?? item?.input ?? item?.args ?? item?.function?.arguments ?? {};
  if (typeof a === "string") {
    try { return JSON.parse(a); } catch { return {}; }
  }
  return a && typeof a === "object" ? a : {};
}

/**
 * Parse tool calls a model emitted as text. Only returns calls whose name is a
 * known tool (via `isKnownTool`) — a strong signal the JSON is an attempted
 * invocation rather than an illustrative example. Handles code fences, a single
 * object, arrays of calls, and a leading prose preamble.
 */
export function parseTextToolCalls(text: string, isKnownTool: (name: string) => boolean): RecoveredCall[] {
  if (!text || !text.trim()) return [];
  const cleaned = text.replace(/```(?:json|tool_call)?/gi, "");
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
