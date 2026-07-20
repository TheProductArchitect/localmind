import { execFile } from "child_process";
import { isSystemIdle, selfImproveMode } from "./idle";
import { recordSelfCheck, listSelfChecks } from "../db/self-checks";
import { createProposal, listProposals } from "../db/proposals";
import { getSettings } from "../db/queries";
import { listRecentConversationIds } from "../db/conversation-summary";
import { buildConversationMessages } from "./conversation-messages";
import { splitHistory, recentWindowSize } from "./history-context";
import { ensureConversationSummary } from "./history-summary";

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

function extractPathsFromDetail(detail: string): string[] {
  const paths = [
    ...detail.matchAll(/(?:^|[\s("'`])((?:src|__tests__|docs)\/[\w./-]+\.(?:ts|tsx|js|jsx|md))/g),
  ].map((m) => m[1]);
  return [...new Set(paths)].slice(0, 8);
}

/**
 * Gate 1 — turn recent failing self-checks into proposal cards. Never writes
 * code or branches; owner must Approve on /ops before any build work.
 */
export function proposeFromFailingChecks(limit = 5): number {
  const open = listProposals("proposed");
  const fails = listSelfChecks(30).filter((c) => c.status === "fail");
  let n = 0;
  for (const c of fails.slice(0, limit)) {
    const title = `Fix failing ${c.kind}: ${(c.summary || "check").slice(0, 80)}`;
    if (open.some((p) => p.title === title)) continue;
    createProposal({
      title,
      rationale: (c.detail || c.summary || "").slice(0, 2000),
      target_paths: extractPathsFromDetail(c.detail || ""),
      benefit: "Restore green idle self-check",
      risk: "Low — proposal only; no code until owner Approve",
    });
    n++;
  }
  return n;
}

/**
 * Precompute the rolling conversation summary (§ intelligent history) for the
 * most recently-active conversations while idle, so live turns pay no summary
 * latency. Uses the SAME message builder + window as the engine, so the
 * covered_count watermark stays consistent. Bounded and best-effort.
 */
export async function refreshConversationSummaries(limit = 5): Promise<number> {
  const s = getSettings();
  const model = s.active_model;
  if (!model) return 0;
  const contextWindow = Number(s.context_window) || 8192;
  let n = 0;
  for (const id of listRecentConversationIds(limit)) {
    const { older } = splitHistory(buildConversationMessages(id), recentWindowSize());
    if (older.length === 0) continue;
    const summary = await ensureConversationSummary(id, older, { model, contextWindow });
    if (summary) n++;
  }
  return n;
}

/**
 * One idle tick. Preemptible by design: it only acts when genuinely idle, and
 * any new user activity flips isSystemIdle() so subsequent ticks stand down.
 *
 * Self-improvement is ideation-only here (Gate 1): even in `propose` mode this
 * function never writes code or branches — proposal cards only.
 */
export async function runIdleCycle(now: Date = new Date()): Promise<IdleTickResult> {
  const state = isSystemIdle(now);
  if (!state.idle) return { ran: false, reason: state.reason, actions: [] };

  const actions: string[] = [];

  try {
    const refreshed = await refreshConversationSummaries();
    if (refreshed > 0) actions.push(`summaries:${refreshed}`);
  } catch {
    /* best-effort */
  }

  if (process.env.LM_IDLE_RUN_TESTS !== "0") {
    try {
      await runTestsCheck();
      actions.push("tests");
    } catch {
      /* recorded as a failed self-check inside runTestsCheck */
    }
  }

  if (selfImproveMode() === "propose") {
    try {
      const created = proposeFromFailingChecks();
      actions.push(created > 0 ? `self_improve:propose:${created}` : "self_improve:propose");
    } catch {
      actions.push("self_improve:propose");
    }
  }

  return { ran: true, reason: "idle", actions };
}
