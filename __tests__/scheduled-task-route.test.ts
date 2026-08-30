import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  isInternalRequest,
  getTask,
  recordTaskRun,
  runAgentCollect,
  createConversation,
  deliver,
} = vi.hoisted(() => ({
  isInternalRequest: vi.fn(() => true),
  getTask: vi.fn(),
  recordTaskRun: vi.fn(),
  runAgentCollect: vi.fn(),
  createConversation: vi.fn(() => ({ id: "scheduled-conv" })),
  deliver: vi.fn(),
}));

vi.mock("../src/lib/internal-auth", () => ({ isInternalRequest }));
vi.mock("../src/lib/db/automations", () => ({ getTask, recordTaskRun }));
vi.mock("../src/lib/agent/engine", () => ({ runAgentCollect }));
vi.mock("../src/lib/db/queries", () => ({ createConversation }));
vi.mock("../src/lib/workflow/deliver", () => ({ deliver }));

import { POST } from "../src/app/api/internal/run-task/route";

const task = {
  id: "task-1",
  name: "Morning briefing",
  prompt: "Brief me",
  delivery_channel: "browser",
  enabled: 1,
  creator_user_id: "user-1",
};

function request() {
  return new NextRequest("http://localhost/api/internal/run-task", {
    method: "POST",
    body: JSON.stringify({ taskId: "task-1" }),
    headers: { "content-type": "application/json" },
  });
}

describe("scheduled task route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInternalRequest.mockReturnValue(true);
    getTask.mockReturnValue(task);
    runAgentCollect.mockResolvedValue("Your briefing");
    deliver.mockResolvedValue(undefined);
  });

  it("runs with the task creator's memory/profile context", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(createConversation).toHaveBeenCalledWith(undefined, "user-1");
    expect(recordTaskRun).toHaveBeenCalledWith("task-1", "Your briefing");
  });

  it("returns a failure status when generation fails so the worker retries", async () => {
    runAgentCollect.mockRejectedValue(new Error("model offline"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: "model offline" });
  });

  it("returns a failure status when delivery fails so the worker retries", async () => {
    deliver.mockRejectedValue(new Error("channel offline"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(recordTaskRun).toHaveBeenCalled();
  });

  it("rejects non-internal callers", async () => {
    isInternalRequest.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(runAgentCollect).not.toHaveBeenCalled();
  });
});
