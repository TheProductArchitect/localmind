import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { bucketLanes, type AgentProcess } from "../src/lib/db/agent-processes";
import { runMigrations } from "../src/lib/db/migrations";

function proc(over: Partial<AgentProcess>): AgentProcess {
  return {
    process_id: "p",
    process_type: "chat",
    display_name: "x",
    owner_user_id: null,
    agent_name: null,
    persona_id: null,
    started_at: 0,
    completed_at: null,
    status: "running",
    current_step: null,
    priority: 0,
    metadata_json: "{}",
    pillar: null,
    parent_process_id: null,
    progress: null,
    ...over,
  };
}

describe("bucketLanes", () => {
  it("sorts active processes into queued/running/needs_you by status", () => {
    const active = [
      proc({ process_id: "a", status: "pending" }),
      proc({ process_id: "b", status: "running" }),
      proc({ process_id: "c", status: "waiting_confirmation" }),
      proc({ process_id: "d", status: "paused" }),
    ];
    const board = bucketLanes(active, []);
    expect(board.lanes.queued.map((p) => p.process_id)).toEqual(["a"]);
    expect(board.lanes.running.map((p) => p.process_id)).toEqual(["b"]);
    expect(board.lanes.needs_you.map((p) => p.process_id)).toEqual(["c", "d"]);
    expect(board.counts.needs_you).toBe(2);
  });

  it("sorts recently-completed into done/failed lanes", () => {
    const recent = [
      proc({ process_id: "e", status: "completed", completed_at: 1 }),
      proc({ process_id: "f", status: "failed", completed_at: 1 }),
      proc({ process_id: "g", status: "cancelled", completed_at: 1 }),
    ];
    const board = bucketLanes([], recent);
    expect(board.lanes.done.map((p) => p.process_id)).toEqual(["e"]);
    expect(board.lanes.failed.map((p) => p.process_id)).toEqual(["f", "g"]);
  });

  it("folds extra needs-you items (e.g. workflow approvals) into the lane", () => {
    const extra = [proc({ process_id: "wf", status: "waiting_confirmation" })];
    const board = bucketLanes([], [], extra);
    expect(board.lanes.needs_you.map((p) => p.process_id)).toEqual(["wf"]);
  });
});

describe("migration v21 — agent_processes ops columns", () => {
  it("adds pillar/parent_process_id/progress columns", () => {
    const db = new Database(":memory:");
    runMigrations(db, "config");
    const cols = (db.prepare("PRAGMA table_info(agent_processes)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("pillar");
    expect(cols).toContain("parent_process_id");
    expect(cols).toContain("progress");
    db.close();
  });
});
