import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSettings = vi.fn();
const getSettings = vi.fn(() => ({
  assistant_name: "Sora",
  pin_hash: null,
  agent_mode: "ask",
  web_search_provider: "auto",
  idle_work_enabled: 0,
  idle_start_hour: 1,
  idle_end_hour: 6,
}));

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => getSettings(),
  updateSettings: (p: any) => updateSettings(p),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (p: string) => `hashed:${p}`) },
}));

import { PATCH } from "../src/app/api/settings/route";

function patchReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/settings allow-list (CRITICAL)", () => {
  beforeEach(() => {
    updateSettings.mockClear();
  });

  it("persists agent_mode (chat header auto/plan/ask toggle)", async () => {
    const res = await PATCH(patchReq({ agent_mode: "auto" }));
    expect(res.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith({ agent_mode: "auto" });
  });

  it("persists web_search_provider", async () => {
    await PATCH(patchReq({ web_search_provider: "you" }));
    expect(updateSettings).toHaveBeenCalledWith({ web_search_provider: "you" });
  });

  it("persists idle_work_enabled / idle_start_hour / idle_end_hour", async () => {
    await PATCH(patchReq({ idle_work_enabled: 1, idle_start_hour: 2, idle_end_hour: 5 }));
    expect(updateSettings).toHaveBeenCalledWith({
      idle_work_enabled: 1,
      idle_start_hour: 2,
      idle_end_hour: 5,
    });
  });

  it("still drops unknown keys", async () => {
    await PATCH(patchReq({ agent_mode: "plan", not_a_real_setting: "x" }));
    expect(updateSettings).toHaveBeenCalledWith({ agent_mode: "plan" });
  });

  it("persists compute_placement / workspace_placement", async () => {
    await PATCH(patchReq({ compute_placement: "local", workspace_placement: "peer-xyz" }));
    expect(updateSettings).toHaveBeenCalledWith({
      compute_placement: "local",
      workspace_placement: "peer-xyz",
    });
  });
});
