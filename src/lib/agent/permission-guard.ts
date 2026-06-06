/**
 * Permission classification with the v2 agent-mode overlay + destructive-tier
 * floor.
 *
 * Four concepts stack, evaluated in this order:
 *
 *   1. LLM-owned actions  — never gated. Memory reads (and a couple of
 *      truly self-contained operations) are part of Sora's cognition;
 *      asking for permission to recall what she's stored would be silly.
 *
 *   2. DESTRUCTIVE FLOOR  — actions that destroy data, modify the OS, or
 *      cannot be reasonably undone ALWAYS require user confirmation,
 *      regardless of the operating mode. Even in "auto" mode, the user
 *      must sign off on every delete, drop, format, kill, or shell-out
 *      that looks like a destructive command. This is the safety contract
 *      Sora and any agent she spawns cannot bypass.
 *
 *   3. Agent mode         — global stance, set in Settings:
 *        "auto" — trust the agent fully on non-destructive actions
 *        "plan" — Sora may read anything; mutations are blocked at the
 *                  permission layer with a tier of "ask"
 *        "ask"  — default. Reads allowed, mutations confirmed.
 *
 *   4. Permission profile — per-action tiers (allow / ask / pin) from the
 *      legacy profile editor. Used as the base tier for "ask" mode.
 *
 * The resulting tier is what the engine actually enforces.
 */

import { getActiveProfile, getSettings, type AgentMode } from "../db/queries";

export type Tier = "allow" | "ask" | "pin";

// Actions the LLM owns — these are part of cognition itself, not "use of a
// tool", and therefore never gated. Memory and self-introspection live here.
const LLM_OWNED: ReadonlySet<string> = new Set([
  "memory_read",
  "read_time",
]);

// Actions Sora can take freely under "plan" mode and which the ask-mode
// default treats as always-allowed. Anything not in this set is treated
// as a mutation by the agent-mode overlay.
const READ_ACTIONS: ReadonlySet<string> = new Set([
  "memory_read",
  "read_files",
  "read_email",
  "read_calendar",
  "web_search",
  "read_time",
]);

// DESTRUCTIVE FLOOR — these actions ALWAYS require user confirmation.
// "auto" mode does NOT bypass this list. The user has to sign off on every
// single delete, drop, format, kill, or shell-out that destroys state.
// Sora's system prompt is told explicitly that she cannot remove files
// or run rm-style commands without an inline approval from the user.
const DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set([
  "delete_files",
  "delete_data",
  "drop_table",
  "destructive_shell",   // CLI/shell tools that detect rm/unlink/format/etc.
  "uninstall",
  "factory_reset",
  "revoke_session",      // can lock the user out — confirm even in auto
  "delete_user",
  "unpair_peer",
  "delete_conversation",
  "delete_memory",
  "delete_knowledge",
  "delete_automation",
  "send_email",          // outbound + irreversible — confirm even in auto
  "make_call",           // outbound + irreversible
  "post_message",        // outbound social posts
  "git_force_push",
  "git_reset_hard",
]);

function isRead(actionType: string): boolean {
  if (READ_ACTIONS.has(actionType)) return true;
  if (actionType.startsWith("read_")) return true;
  return false;
}

export function isDestructive(actionType: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(actionType);
}

export function classify(actionType: string): Tier {
  // (1) LLM-owned actions are unconditionally allowed across every mode.
  if (LLM_OWNED.has(actionType)) return "allow";

  // (2) DESTRUCTIVE FLOOR — always ask. Cannot be bypassed by any mode.
  // The user can still pre-approve a per-action tier of "pin" for these
  // in their permission profile if they want PIN gating, but raw "allow"
  // is explicitly NOT honoured for destructive actions.
  if (DESTRUCTIVE_ACTIONS.has(actionType)) {
    const profile = getActiveProfile();
    const tier = profile.tiers[actionType];
    if (tier === "pin") return "pin";
    return "ask";
  }

  const mode: AgentMode = getSettings().agent_mode || "ask";

  // (3a) Auto mode: trust the agent fully on non-destructive actions.
  if (mode === "auto") return "allow";

  // (3b) Plan mode: reads free; non-destructive mutations gated as "ask".
  if (mode === "plan") {
    if (isRead(actionType)) return "allow";
    return "ask";
  }

  // (3c) Ask mode (default): reads free; mutations consult the profile.
  if (isRead(actionType)) return "allow";

  // (4) Per-action tier from the profile.
  const profile = getActiveProfile();
  const tier = profile.tiers[actionType];
  if (tier === "allow" || tier === "ask" || tier === "pin") return tier;
  return "ask";
}

/** Exposed for the system-prompt assembler so Sora knows the current stance. */
export function currentAgentMode(): AgentMode {
  return getSettings().agent_mode || "ask";
}

/**
 * Inspect a shell-style command string and decide whether it should be
 * classified as `destructive_shell` (forcing user confirmation regardless of
 * mode). Conservative by design — we'd rather ask too often than too rarely.
 */
const DESTRUCTIVE_CMD_PATTERNS: RegExp[] = [
  /\brm\b\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)?/i,      // rm, rm -rf, rm -r, rm -f
  /\bunlink\b/i,
  /\brmdir\b/i,
  /\bshred\b/i,
  /\bmkfs\b/i,                                       // format a filesystem
  /\bdiskutil\s+erase/i,                             // macOS disk erase
  /\bdd\b\s+if=.+\s+of=\/dev\//i,                    // dd to a device
  /\b:>\s*\/\S+/,                                    // truncate file via redirection
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\s+(?:--force|-f)\b/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+clean\s+-f/i,
  /\bnpm\s+uninstall\b/i,
  /\bbrew\s+uninstall\b/i,
  /\bdocker\s+(?:rm|rmi|volume\s+rm)\b/i,
  /\bsudo\b/,                                        // anything sudo'd
  /\bkillall\b/i,
  /\bpkill\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
];

export function isDestructiveCommand(command: string): boolean {
  if (!command) return false;
  return DESTRUCTIVE_CMD_PATTERNS.some((re) => re.test(command));
}
