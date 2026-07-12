import { execFile } from "child_process";
import { isSystemIdle, selfImproveMode } from "./idle";
import { recordSelfCheck } from "../db/self-checks";

// Result of one idle tick. `ran` is false when the system wasn't idle-eligible.
export type IdleTickResult = { ran: boolean; reason: string; actions: string[] };

/**
 * Run the app's own test suite (read-only w.r.t. app code) and record the
 * outcome to `self_checks`. Never edits code. Bounded by a timeout so a hung
 * test can't wedge the worker.
 */
export function runTestsCheck(cwd = process.cwd(), timeoutMs = 5 * 60 * 1000): Promise<void> {
  return new Promise((resolve) => {
    execFile("npm", ["test", "--silent"], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ""}\n${stderr || ""}`.trim();
      const passMatch = out.match(/Tests\s+(\d+)\s+passed/);
      if (!err) {
        recordSelfCheck({ kind: "tests", status: "pass", summary: passMatch ? `${passMatch[1]} passed` : "passed", detail: out.slice(-4000) });
      } else {
        recordSelfCheck({ kind: "tests", status: "fail", summary: "test run failed", detail: out.slice(-4000) });
      }
      resolve();
    });
  });
}

/**
 * One idle tick. Preemptible by design: it only acts when genuinely idle, and
 * any new user activity flips isSystemIdle() so subsequent ticks stand down.
 *
 * Self-improvement is ideation-only here (Gate 1): even in `propose` mode this
 * function never writes code or branches — proposal *cards* are created via the
 * proposals API, and building only happens after owner approval (§7.2).
 */
export async function runIdleCycle(now: Date = new Date()): Promise<IdleTickResult> {
  const state = isSystemIdle(now);
  if (!state.idle) return { ran: false, reason: state.reason, actions: [] };

  const actions: string[] = [];

  // Test runner (opt-out via LM_IDLE_RUN_TESTS=0). Read-only w.r.t. app code.
  if (process.env.LM_IDLE_RUN_TESTS !== "0") {
    try {
      await runTestsCheck();
      actions.push("tests");
    } catch {
      /* recorded as a failed self-check inside runTestsCheck */
    }
  }

  // Self-improvement stays at Gate 1: mode is surfaced for the (separate)
  // proposal-generation step; this tick never authors code or branches.
  if (selfImproveMode() === "propose") {
    actions.push("self_improve:propose");
  }

  return { ran: true, reason: "idle", actions };
}
