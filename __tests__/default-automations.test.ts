import { describe, it, expect, vi, beforeEach } from "vitest";

type TaskArg = { name: string; cron?: string; prompt?: string; delivery_channel?: string };
const tasks: { name: string }[] = [];
const createTask = vi.fn((o: TaskArg) => {
  tasks.push({ name: o.name });
  return { id: "t1", ...o };
});

vi.mock("../src/lib/db/automations", () => ({
  listTasks: () => tasks,
  createTask: (o: TaskArg) => createTask(o),
}));

import { ensureDefaultAutomations } from "../src/lib/default-automations";

describe("ensureDefaultAutomations", () => {
  beforeEach(() => {
    tasks.length = 0;
    createTask.mockClear();
  });

  it("creates morning briefing when missing", () => {
    ensureDefaultAutomations();
    expect(createTask).toHaveBeenCalledOnce();
    expect(createTask.mock.calls[0][0].name).toBe("Morning Briefing");
    expect(createTask.mock.calls[0][0].cron).toBe("0 8 * * *");
  });

  it("is idempotent when briefing already exists", () => {
    tasks.push({ name: "Morning Briefing" });
    ensureDefaultAutomations();
    expect(createTask).not.toHaveBeenCalled();
  });
});
