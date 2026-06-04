/**
 * Permission classification with the v2 agent-mode overlay.
 *
 * Three concepts stack:
 *
 *   1. LLM-owned actions  — never gated. Memory reads (and a couple of
 *      truly self-contained operations) are part of Sora's own cognition;
 *      asking for permission to recall what she's stored would be silly.
 *
 *   2. Agent mode         — global stance, set in Settings:
 *        "auto" — trust the agent fully, every action runs through
 *        "plan" — Sora may read anything; mutations are blocked at the
 *                  permission layer with a tier of "ask" (the user steps
 *                  out of plan mode by approving)
 *        "ask"  — default. Reads allowed, mutations require confirmation.
 *
 *   3. Permission profile — per-action tiers (allow / ask / pin) from the
 *      legacy profile editor. Used as the *base* tier; the agent mode is
 *      an overlay on top.
 *
 * The resulting tier is what the engine actually enforces.
 */

import { getActiveProfile, getSettings, type AgentMode } from "../db/queries";

export type Tier = "allow" | "ask" | "pin";

// Actions the LLM owns — these are part of cognition itself, not "use of a
// tool", and therefore never gated. Memory and self-introspection live here.
const LLM_OWNED: ReadonlySet<string> = new Set([
  "memory_read",
]);

// Read-shaped actions — safe under "plan" mode and never elevated beyond
// "ask" by the mode overlay. Anything not in this set is treated as a
// mutation by the agent-mode overlay.
const READ_ACTIONS: ReadonlySet<string> = new Set([
  "memory_read",
  "read_files",
  "read_email",
  "read_calendar",
  "web_search",
]);

function isRead(actionType: string): boolean {
  if (READ_ACTIONS.has(actionType)) return true;
  // Convention: "read_*" prefix implies a read.
  if (actionType.startsWith("read_")) return true;
  return false;
}

export function classify(actionType: string): Tier {
  // LLM-owned actions are unconditionally allowed across every mode.
  if (LLM_OWNED.has(actionType)) return "allow";

  const mode: AgentMode = getSettings().agent_mode || "ask";

  // Auto mode: trust the agent fully.
  if (mode === "auto") return "allow";

  // Plan mode: reads are free; mutations are gated as "ask" so the user can
  // step out of plan mode by approving inline (we don't have a "deny" tier
  // and forcing one would surprise the agent — "ask" preserves the existing
  // confirmation flow while keeping plan-mode the safe default).
  if (mode === "plan") {
    if (isRead(actionType)) return "allow";
    return "ask";
  }

  // Ask mode: reads are free; mutations consult the user's per-action tier
  // from the active profile (which can still be "allow" if the user pre-
  // approved that specific action).
  if (isRead(actionType)) return "allow";

  const profile = getActiveProfile();
  const tier = profile.tiers[actionType];
  if (tier === "allow" || tier === "ask" || tier === "pin") return tier;
  return "ask";
}

/** Exposed for the system-prompt assembler so Sora knows the current stance. */
export function currentAgentMode(): AgentMode {
  return getSettings().agent_mode || "ask";
}
