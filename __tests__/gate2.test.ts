import { describe, it, expect, vi, beforeEach } from "vitest";

const proposals: any[] = [];
const projects: any[] = [];

vi.mock("../src/lib/db/proposals", () => ({
  listProposals: (status?: string) =>
    status ? proposals.filter((p) => p.status === status) : proposals,
  setProposalStatus: (id: string, status: string, patch: any = {}) => {
    const p = proposals.find((x) => x.id === id);
    if (!p) throw new Error("missing");
    // Enforce simple transitions for the test
    const ok =
      (p.status === "approved" && status === "building") ||
      (p.status === "building" && status === "ready_for_review");
    if (!ok && p.status !== status) throw new Error(`Illegal ${p.status} → ${status}`);
    Object.assign(p, { status, ...patch });
    return p;
  },
}));

vi.mock("../src/lib/db/coding", () => ({
  listCodingProjects: () => projects,
}));

const createWorktreeSession = vi.fn();
const startSweLoop = vi.fn();

vi.mock("../src/lib/coding/worktree", () => ({
  createWorktreeSession: (...args: any[]) => createWorktreeSession(...args),
}));
vi.mock("../src/lib/coding/swe-graph", () => ({
  startSweLoop: (...args: any[]) => startSweLoop(...args),
}));

import { processApprovedProposals } from "../src/lib/coding/gate2";

describe("processApprovedProposals", () => {
  beforeEach(() => {
    proposals.length = 0;
    projects.length = 0;
    createWorktreeSession.mockReset();
    startSweLoop.mockReset();
    delete process.env.LM_SELF_IMPROVE_PROJECT_ID;
  });

  it("no-ops when no coding project is registered", async () => {
    proposals.push({
      id: "prop-1",
      title: "Fix tests",
      rationale: "red",
      target_paths: "[]",
      status: "approved",
    });
    const r = await processApprovedProposals();
    expect(r.started).toBe(0);
    expect(r.errors[0]).toMatch(/no coding project/i);
    expect(createWorktreeSession).not.toHaveBeenCalled();
  });

  it("starts a session + SWE loop for an approved proposal", async () => {
    projects.push({ id: "cproj-1", name: "app", repo_path: "/tmp/app" });
    proposals.push({
      id: "prop-2",
      title: "Add widget",
      rationale: "need it",
      target_paths: "[]",
      status: "approved",
    });
    createWorktreeSession.mockReturnValue({
      ok: true,
      session: { id: "csess-9", branch: "localmind/add-widget", worktree_path: "/tmp/wt" },
    });
    startSweLoop.mockResolvedValue({ ok: true, graph_id: "g-1" });

    const r = await processApprovedProposals();
    expect(r.started).toBe(1);
    expect(createWorktreeSession).toHaveBeenCalled();
    expect(startSweLoop).toHaveBeenCalledWith("csess-9");
    expect(proposals[0].status).toBe("building");
    expect(proposals[0].audit_ref).toBe("csess-9");
  });
});
