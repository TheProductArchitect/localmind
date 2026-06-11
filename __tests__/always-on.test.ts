import { describe, it, expect } from "vitest";
import { planInstall, platformKind } from "../src/lib/always-on";

/**
 * planInstall builds an OS-specific service plan + the exact commands the
 * user runs to activate it. We don't shell anything out — installing a
 * system service is a deliberate user step. These tests pin the plan shape
 * so a future refactor doesn't silently drop activation steps or change
 * the path the unit file lands at.
 */
describe("always-on planInstall", () => {
  it("classifies platform correctly", () => {
    const k = platformKind();
    expect(["macos", "linux", "unsupported"]).toContain(k);
  });

  it("returns a complete plan for the running platform", () => {
    const plan = planInstall();
    if (plan.platform === "unsupported") {
      expect(plan.reason).toBeTruthy();
      return;
    }
    expect(plan.service_path).toMatch(plan.platform === "macos" ? /LaunchAgents/ : /systemd\/user/);
    expect(plan.contents).toContain(plan.platform === "macos" ? "<plist" : "[Service]");
    expect(plan.activate_commands.length).toBeGreaterThan(0);
    expect(plan.deactivate_commands.length).toBeGreaterThan(0);
  });

  it("macOS plist includes RunAtLoad + KeepAlive so launchd restarts on crash", () => {
    const plan = planInstall();
    if (plan.platform !== "macos") return;
    expect(plan.contents).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plan.contents).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("linux unit includes Restart=always so systemd restarts on crash", () => {
    const plan = planInstall();
    if (plan.platform !== "linux") return;
    expect(plan.contents).toMatch(/Restart=always/);
  });

  it("activate commands reference the same service path the plan declares", () => {
    const plan = planInstall();
    if (plan.platform === "unsupported") return;
    const joined = plan.activate_commands.join(" ");
    // mac uses the plist path; linux uses unit name without full path
    if (plan.platform === "macos") {
      expect(joined).toContain(plan.service_path);
    } else {
      expect(joined).toContain("localmind.service");
    }
  });
});
