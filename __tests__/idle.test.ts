import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let settings: any = { idle_work_enabled: 1, idle_start_hour: 1, idle_end_hour: 6 };
let active: any[] = [];
vi.mock("../src/lib/db/queries", () => ({ getSettings: () => settings }));
vi.mock("../src/lib/db/agent-processes", () => ({ listActive: () => active }));

import { inIdleWindow, isSystemIdle, selfImproveMode } from "../src/lib/agent/idle";

function at(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  return d;
}

describe("inIdleWindow", () => {
  it("handles a normal daytime window", () => {
    expect(inIdleWindow(at(3), 1, 6)).toBe(true);
    expect(inIdleWindow(at(0), 1, 6)).toBe(false);
    expect(inIdleWindow(at(6), 1, 6)).toBe(false);
  });
  it("handles a window that wraps midnight", () => {
    expect(inIdleWindow(at(23), 22, 6)).toBe(true);
    expect(inIdleWindow(at(3), 22, 6)).toBe(true);
    expect(inIdleWindow(at(12), 22, 6)).toBe(false);
  });
  it("treats equal start/end as a full-day window", () => {
    expect(inIdleWindow(at(15), 0, 0)).toBe(true);
  });
});

describe("isSystemIdle", () => {
  beforeEach(() => {
    settings = { idle_work_enabled: 1, idle_start_hour: 1, idle_end_hour: 6 };
    active = [];
  });

  it("is idle when opted-in, in window, and no active non-maintain work", () => {
    expect(isSystemIdle(at(3)).idle).toBe(true);
  });
  it("is not idle when disabled", () => {
    settings.idle_work_enabled = 0;
    expect(isSystemIdle(at(3)).idle).toBe(false);
  });
  it("is not idle outside the window", () => {
    expect(isSystemIdle(at(12)).idle).toBe(false);
  });
  it("is not idle when a non-maintain process is active", () => {
    active = [{ pillar: "research" }];
    expect(isSystemIdle(at(3)).idle).toBe(false);
  });
  it("ignores maintain processes so the idle cycle can chain work", () => {
    active = [{ pillar: "maintain" }];
    expect(isSystemIdle(at(3)).idle).toBe(true);
  });
});

describe("selfImproveMode", () => {
  const orig = process.env.LM_SELF_IMPROVE;
  afterEach(() => { if (orig === undefined) delete process.env.LM_SELF_IMPROVE; else process.env.LM_SELF_IMPROVE = orig; });
  it("defaults to off", () => {
    delete process.env.LM_SELF_IMPROVE;
    expect(selfImproveMode()).toBe("off");
  });
  it("is propose only when explicitly set", () => {
    process.env.LM_SELF_IMPROVE = "propose";
    expect(selfImproveMode()).toBe("propose");
  });
});
