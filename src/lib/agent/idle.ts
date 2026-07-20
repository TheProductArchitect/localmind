import { getSettings } from "../db/queries";
import { listActive } from "../db/agent-processes";

// Self-improvement is two-gate and off by default. There is intentionally no
// "auto-build" / "auto-merge" value (§7.2).
export type SelfImproveMode = "propose" | "off";
export function selfImproveMode(): SelfImproveMode {
  return process.env.LM_SELF_IMPROVE === "propose" ? "propose" : "off";
}

/**
 * Is `now` inside the configured idle window [startHour, endHour)? Handles
 * windows that wrap past midnight (e.g. 22 → 6). Pure + testable.
 */
export function inIdleWindow(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getHours();
  if (startHour === endHour) return true; // full-day window
  if (startHour < endHour) return h >= startHour && h < endHour;
  // Wraps midnight.
  return h >= startHour || h < endHour;
}

export type IdleState = {
  idle: boolean;
  reason: string;
};

/**
 * The system is idle-eligible when the user opted in, we're inside the window,
 * and there is no active agent work. Load/SSE checks are layered by the caller.
 */
export function isSystemIdle(now: Date = new Date()): IdleState {
  const s = getSettings();
  if (!s.idle_work_enabled) return { idle: false, reason: "idle work disabled" };
  if (!inIdleWindow(now, s.idle_start_hour, s.idle_end_hour)) {
    return { idle: false, reason: "outside idle window" };
  }
  const active = listActive();
  // Ignore already-running idle/maintain jobs so the tick can chain work.
  const nonMaintain = active.filter((p) => p.pillar !== "maintain");
  if (nonMaintain.length > 0) return { idle: false, reason: `${nonMaintain.length} active process(es)` };
  return { idle: true, reason: "idle" };
}
