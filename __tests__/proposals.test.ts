import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/lib/db/migrations";

let db: Database.Database;
vi.mock("../src/lib/db", () => ({ getConfigDb: () => db }));

import {
  createProposal,
  getProposal,
  listProposals,
  setProposalStatus,
  canTransition,
} from "../src/lib/db/proposals";
import { recordSelfCheck, listSelfChecks } from "../src/lib/db/self-checks";
import { bucketLanes, type AgentProcess } from "../src/lib/db/agent-processes";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, "config");
});

describe("improvement_proposals lifecycle", () => {
  it("creates a card at 'proposed' with no code artifacts", () => {
    const p = createProposal({ title: "Speed up search", rationale: "N+1 query", target_paths: ["src/lib/db/vec.ts"] });
    expect(p.status).toBe("proposed");
    expect(p.branch).toBeNull();
    expect(p.pr_url).toBeNull();
    expect(JSON.parse(p.target_paths)).toEqual(["src/lib/db/vec.ts"]);
  });

  it("only allows the approval gate transitions", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("proposed", "rejected")).toBe(true);
    expect(canTransition("proposed", "building")).toBe(false); // must be approved first
    expect(canTransition("proposed", "merged")).toBe(false);
    expect(canTransition("approved", "building")).toBe(true);
    expect(canTransition("building", "ready_for_review")).toBe(true);
    expect(canTransition("ready_for_review", "merged")).toBe(true);
    expect(canTransition("rejected", "approved")).toBe(false);
  });

  it("approve advances proposed → approved and stamps approved_at", () => {
    const p = createProposal({ title: "x", rationale: "y" });
    const updated = setProposalStatus(p.id, "approved", { audit_ref: "42" });
    expect(updated!.status).toBe("approved");
    expect(updated!.approved_at).toBeGreaterThan(0);
    expect(updated!.audit_ref).toBe("42");
  });

  it("throws on an illegal transition (can't skip approval)", () => {
    const p = createProposal({ title: "x", rationale: "y" });
    expect(() => setProposalStatus(p.id, "building")).toThrow(/Illegal proposal transition/);
    expect(() => setProposalStatus(p.id, "merged")).toThrow();
  });

  it("lists by status", () => {
    createProposal({ title: "a", rationale: "r" });
    const b = createProposal({ title: "b", rationale: "r" });
    setProposalStatus(b.id, "rejected");
    expect(listProposals("proposed")).toHaveLength(1);
    expect(listProposals("rejected")).toHaveLength(1);
    expect(listProposals()).toHaveLength(2);
  });
});

describe("self_checks", () => {
  it("records and lists test-run outcomes", () => {
    recordSelfCheck({ kind: "tests", status: "pass", summary: "170 passed" });
    const checks = listSelfChecks();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: "tests", status: "pass" });
  });
});

describe("board Proposals lane", () => {
  function card(id: string, status: AgentProcess["status"]): AgentProcess {
    return {
      process_id: id, process_type: "long_running_job", display_name: id, owner_user_id: null,
      agent_name: null, persona_id: null, started_at: 0, completed_at: null, status,
      current_step: null, priority: 0, metadata_json: "{}", pillar: "maintain",
      parent_process_id: null, progress: null,
    };
  }
  it("places proposal cards in their own lane", () => {
    const board = bucketLanes([], [], [], [card("proposal-1", "waiting_confirmation")]);
    expect(board.lanes.proposals.map((p) => p.process_id)).toEqual(["proposal-1"]);
    expect(board.counts.proposals).toBe(1);
  });
});
