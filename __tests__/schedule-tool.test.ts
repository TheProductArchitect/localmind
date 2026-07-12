import { describe, it, expect, vi, beforeEach } from "vitest";

type Task = {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  delivery_channel: string;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
  last_output: string | null;
  creator_user_id: string | null;
};

let store: Task[] = [];
const createTask = vi.fn((o: { name: string; cron: string; prompt: string; delivery_channel?: string; creator?: string }) => {
  const t: Task = {
    id: "task1",
    name: o.name,
    cron: o.cron,
    prompt: o.prompt,
    delivery_channel: o.delivery_channel || "browser",
    enabled: 1,
    created_at: Date.now(),
    last_run_at: null,
    last_output: null,
    creator_user_id: o.creator ?? null,
  };
  store.push(t);
  return t;
});

vi.mock("../src/lib/db/automations", () => ({
  listTasks: () => store,
  getTask: (id: string) => store.find((t) => t.id === id) || null,
  createTask: (o: any) => createTask(o),
  setTaskEnabled: (id: string, enabled: boolean) => {
    const t = store.find((x) => x.id === id);
    if (t) t.enabled = enabled ? 1 : 0;
  },
  deleteTask: (id: string) => {
    store = store.filter((t) => t.id !== id);
  },
  updateTask: (id: string, patch: any) => {
    const t = store.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    return t;
  },
}));

let enabledChannels: { type: string; enabled: boolean }[] = [];
vi.mock("../src/lib/db/channels", () => ({
  listChannels: () => enabledChannels,
}));

vi.mock("../src/lib/db/queries", () => ({
  getConversation: (_id: string) => ({ owner_user_id: "owner-1" }),
}));

import { scheduleTool } from "../src/lib/tools/schedule";

const ctx = { conversationId: "c1", approvedDirs: [] };

describe("schedule_task tool", () => {
  beforeEach(() => {
    store = [];
    enabledChannels = [];
    createTask.mockClear();
  });

  it("classifies operations into correct action types", () => {
    expect(scheduleTool.classify!({ operation: "list" })).toBe("read_schedule");
    expect(scheduleTool.classify!({ operation: "create" })).toBe("schedule_write");
    expect(scheduleTool.classify!({ operation: "update" })).toBe("schedule_write");
    expect(scheduleTool.classify!({ operation: "set_enabled" })).toBe("schedule_write");
    expect(scheduleTool.classify!({ operation: "delete" })).toBe("delete_automation");
  });

  it("preview shows the resolved human-readable schedule before approval", () => {
    const preview = scheduleTool.preview!({
      operation: "create",
      name: "AI news",
      schedule: "weekdays at 7:30",
    });
    expect(preview).toContain("weekdays at 07:30");
  });

  it("create resolves natural language to cron and scopes to the conversation owner", async () => {
    const res = await scheduleTool.execute(
      { operation: "create", name: "AI news", schedule: "weekdays at 7:30", prompt: "Summarize overnight AI news" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(createTask).toHaveBeenCalledOnce();
    const arg = createTask.mock.calls[0][0];
    expect(arg.cron).toBe("30 7 * * 1-5");
    expect(arg.creator).toBe("owner-1");
    expect(res.output).toContain("30 7 * * 1-5");
  });

  it("create passes through an explicit 5-field cron unchanged", async () => {
    await scheduleTool.execute(
      { operation: "create", name: "Nightly", schedule: "0 3 * * *", prompt: "run" },
      ctx
    );
    expect(createTask.mock.calls[0][0].cron).toBe("0 3 * * *");
  });

  it("rejects a delivery channel that is not enabled", async () => {
    const res = await scheduleTool.execute(
      { operation: "create", name: "x", schedule: "daily at 9", prompt: "p", delivery_channel: "telegram" },
      ctx
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not enabled");
  });

  it("allows an enabled delivery channel", async () => {
    enabledChannels = [{ type: "telegram", enabled: true }];
    const res = await scheduleTool.execute(
      { operation: "create", name: "x", schedule: "daily at 9", prompt: "p", delivery_channel: "telegram" },
      ctx
    );
    expect(res.ok).toBe(true);
  });

  it("browser channel is always available even with no channels enabled", async () => {
    const res = await scheduleTool.execute(
      { operation: "create", name: "x", schedule: "daily at 9", prompt: "p", delivery_channel: "browser" },
      ctx
    );
    expect(res.ok).toBe(true);
  });

  it("requires name, schedule, and prompt on create", async () => {
    const res = await scheduleTool.execute({ operation: "create", name: "x" }, ctx);
    expect(res.ok).toBe(false);
  });

  it("list summarizes existing tasks", async () => {
    await scheduleTool.execute({ operation: "create", name: "Nightly", schedule: "0 3 * * *", prompt: "run" }, ctx);
    const res = await scheduleTool.execute({ operation: "list" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("Nightly");
    expect(res.output).toContain("daily at 03:00");
  });

  it("set_enabled disables a task", async () => {
    await scheduleTool.execute({ operation: "create", name: "N", schedule: "0 3 * * *", prompt: "run" }, ctx);
    const res = await scheduleTool.execute({ operation: "set_enabled", id: "task1", enabled: false }, ctx);
    expect(res.ok).toBe(true);
    expect(store[0].enabled).toBe(0);
  });

  it("delete removes a task", async () => {
    await scheduleTool.execute({ operation: "create", name: "N", schedule: "0 3 * * *", prompt: "run" }, ctx);
    const res = await scheduleTool.execute({ operation: "delete", id: "task1" }, ctx);
    expect(res.ok).toBe(true);
    expect(store).toHaveLength(0);
  });

  it("update changes the cron via new natural-language schedule", async () => {
    await scheduleTool.execute({ operation: "create", name: "N", schedule: "0 3 * * *", prompt: "run" }, ctx);
    const res = await scheduleTool.execute({ operation: "update", id: "task1", schedule: "every hour" }, ctx);
    expect(res.ok).toBe(true);
    expect(store[0].cron).toBe("0 * * * *");
  });
});
