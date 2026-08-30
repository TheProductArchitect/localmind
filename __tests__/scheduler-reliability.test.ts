import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listTasks,
  listDueOneShots,
  recordTaskRun,
  setTaskEnabled,
  runAgentCollect,
  deliver,
  createConversation,
  cronMatches,
} = vi.hoisted(() => ({
  listTasks: vi.fn(),
  listDueOneShots: vi.fn(),
  recordTaskRun: vi.fn(),
  setTaskEnabled: vi.fn(),
  runAgentCollect: vi.fn(),
  deliver: vi.fn(),
  createConversation: vi.fn(() => ({ id: "scheduled-conv" })),
  cronMatches: vi.fn(() => false),
}));

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/lib/cron", () => ({ cronMatches }));
vi.mock("../src/lib/db/automations", () => ({
  listTasks,
  listDueOneShots,
  recordTaskRun,
  setTaskEnabled,
}));
vi.mock("../src/lib/agent/engine", () => ({ runAgentCollect }));
vi.mock("../src/lib/db/queries", () => ({
  createConversation,
}));
vi.mock("../src/lib/workflow/deliver", () => ({ deliver }));

import { __scheduler_internals } from "../src/lib/scheduler";

const task = {
  id: "task-1",
  name: "Morning briefing",
  creator_user_id: "user-1",
  cron: "@once",
  prompt: "Give me today's briefing",
  delivery_channel: "browser",
  enabled: 1,
  created_at: 1,
  last_run_at: null,
  last_output: null,
  run_at: 1,
};

describe("scheduler reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTasks.mockReturnValue([]);
    listDueOneShots.mockReturnValue([task]);
    runAgentCollect.mockResolvedValue("Your briefing");
    deliver.mockResolvedValue(undefined);
    cronMatches.mockReturnValue(false);
  });

  it("disables a one-shot only after generation and delivery succeed", async () => {
    await __scheduler_internals.tickOnce();
    expect(createConversation).toHaveBeenCalledWith(undefined, "user-1");
    expect(deliver).toHaveBeenCalledWith("browser", "[Morning briefing]\n\nYour briefing");
    expect(setTaskEnabled).toHaveBeenCalledWith("task-1", false);
  });

  it("keeps a one-shot enabled when generation fails so the next tick retries", async () => {
    runAgentCollect.mockRejectedValue(new Error("model unavailable"));
    await __scheduler_internals.tickOnce();
    expect(setTaskEnabled).not.toHaveBeenCalled();
  });

  it("keeps a one-shot enabled when delivery fails so it is not silently lost", async () => {
    deliver.mockRejectedValue(new Error("channel offline"));
    await __scheduler_internals.tickOnce();
    expect(recordTaskRun).toHaveBeenCalledWith("task-1", "Your briefing");
    expect(setTaskEnabled).not.toHaveBeenCalled();
  });

  it("reports whether a direct task run completed", async () => {
    await expect(__scheduler_internals.runTaskOnce(task)).resolves.toBe(true);
    deliver.mockRejectedValueOnce(new Error("offline"));
    await expect(__scheduler_internals.runTaskOnce(task)).resolves.toBe(false);
  });

  it("does not run a recurring task twice in the same minute after restart", async () => {
    listDueOneShots.mockReturnValue([]);
    cronMatches.mockReturnValue(true);
    listTasks.mockReturnValue([
      {
        ...task,
        cron: "* * * * *",
        run_at: null,
        last_run_at: Date.now(),
      },
    ]);
    await __scheduler_internals.tickOnce();
    expect(runAgentCollect).not.toHaveBeenCalled();
  });
});
