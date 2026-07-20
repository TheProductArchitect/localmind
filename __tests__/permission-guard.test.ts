import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB module BEFORE importing the guard so its module-level
// closures pick up the mock instead of hitting SQLite.
vi.mock("../src/lib/db/queries", () => ({
  getSettings: vi.fn(() => ({ agent_mode: "ask" })),
  getActiveProfile: vi.fn(() => ({ tiers: {} })),
}));

import {
  classify,
  isDestructive,
  isDestructiveCommand,
} from "../src/lib/agent/permission-guard";
import { getSettings, getActiveProfile } from "../src/lib/db/queries";

const mockedSettings = vi.mocked(getSettings);
const mockedProfile = vi.mocked(getActiveProfile);

/**
 * The permission-guard enforces the destructive-action floor. The user's
 * contract is: even in auto mode, every delete / drop / outbound-send must
 * be confirmed inline. These tests pin that contract — a future change that
 * accidentally lets a destructive action through in auto mode WILL break.
 */
describe("permission-guard", () => {
  beforeEach(() => {
    mockedSettings.mockReturnValue({ agent_mode: "ask" } as any);
    mockedProfile.mockReturnValue({ tiers: {} } as any);
  });

  describe("destructive-action floor", () => {
    it("destructive actions ALWAYS return 'ask' (or 'pin'), even in auto mode", () => {
      mockedSettings.mockReturnValue({ agent_mode: "auto" } as any);
      for (const action of [
        "delete_files",
        "delete_data",
        "drop_table",
        "destructive_shell",
        "uninstall",
        "factory_reset",
        "revoke_session",
        "delete_user",
        "send_email",
        "make_call",
        "post_message",
        "git_force_push",
        "git_reset_hard",
        "install_mcp",
        "schedule_write",
      ]) {
        const tier = classify(action);
        expect(tier, `${action} in auto mode`).not.toBe("allow");
        expect(["ask", "pin"]).toContain(tier);
      }
    });

    it("destructive actions return 'pin' if the profile explicitly pins them", () => {
      mockedProfile.mockReturnValue({ tiers: { delete_files: "pin" } } as any);
      expect(classify("delete_files")).toBe("pin");
    });

    it("destructive actions return 'ask' if profile tries to allow them — allow is NOT honoured", () => {
      mockedProfile.mockReturnValue({ tiers: { delete_files: "allow" } } as any);
      // Profile said "allow" but the floor forces "ask". This is the contract.
      expect(classify("delete_files")).toBe("ask");
    });

    it("isDestructive() is consistent with the floor list", () => {
      expect(isDestructive("delete_files")).toBe(true);
      expect(isDestructive("send_email")).toBe(true);
      expect(isDestructive("memory_read")).toBe(false);
      expect(isDestructive("web_search")).toBe(false);
    });

    it("browser_automation is on the always-confirm floor", () => {
      // Raw browser navigation bypasses Secure Browser MCP's SSRF guard and
      // injection scanner. Every nav must get user confirmation regardless
      // of mode — auto mode does NOT bypass this. If this test starts
      // failing, someone has loosened a security floor; read the comment in
      // permission-guard.ts before changing the assertion.
      expect(isDestructive("browser_automation")).toBe(true);
      for (const mode of ["auto", "plan", "ask"] as const) {
        mockedSettings.mockReturnValue({ agent_mode: mode } as any);
        expect(classify("browser_automation")).toBe("ask");
      }
    });
  });

  describe("LLM-owned actions", () => {
    it("memory_read is always allowed across every mode", () => {
      for (const mode of ["auto", "plan", "ask"] as const) {
        mockedSettings.mockReturnValue({ agent_mode: mode } as any);
        expect(classify("memory_read")).toBe("allow");
      }
    });

    it("read_time is always allowed across every mode", () => {
      for (const mode of ["auto", "plan", "ask"] as const) {
        mockedSettings.mockReturnValue({ agent_mode: mode } as any);
        expect(classify("read_time")).toBe("allow");
      }
    });
  });

  describe("agent-mode overlay", () => {
    it("auto mode allows non-destructive mutations", () => {
      mockedSettings.mockReturnValue({ agent_mode: "auto" } as any);
      expect(classify("write_files")).toBe("allow");
      expect(classify("schedule_task")).toBe("allow");
    });

    it("plan mode allows reads but blocks mutations as 'ask'", () => {
      mockedSettings.mockReturnValue({ agent_mode: "plan" } as any);
      expect(classify("read_files")).toBe("allow");
      expect(classify("web_search")).toBe("allow");
      expect(classify("write_files")).toBe("ask");
      expect(classify("schedule_task")).toBe("ask");
    });

    it("ask mode falls through to the per-action profile tier", () => {
      mockedSettings.mockReturnValue({ agent_mode: "ask" } as any);
      mockedProfile.mockReturnValue({
        tiers: { write_files: "allow", schedule_task: "pin" },
      } as any);
      expect(classify("write_files")).toBe("allow");
      expect(classify("schedule_task")).toBe("pin");
    });

    it("ask mode defaults to 'ask' when the profile has no entry", () => {
      mockedSettings.mockReturnValue({ agent_mode: "ask" } as any);
      mockedProfile.mockReturnValue({ tiers: {} } as any);
      expect(classify("write_files")).toBe("ask");
    });

    it("falls back to auto when agent_mode is unset (auto is the default)", () => {
      mockedSettings.mockReturnValue({} as any);
      expect(classify("write_files")).toBe("allow");
      // Destructive floor still holds even on the auto fallback.
      expect(classify("delete_files")).toBe("ask");
    });
  });

  describe("isDestructiveCommand — shell-string heuristic", () => {
    it("flags rm with recursive/force flags", () => {
      expect(isDestructiveCommand("rm -rf /tmp/x")).toBe(true);
      expect(isDestructiveCommand("rm -r foo")).toBe(true);
      expect(isDestructiveCommand("rm -f foo")).toBe(true);
    });

    it("flags shred / mkfs / dd-to-device", () => {
      expect(isDestructiveCommand("shred ~/.ssh/id_rsa")).toBe(true);
      expect(isDestructiveCommand("mkfs.ext4 /dev/sda1")).toBe(true);
      expect(isDestructiveCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
    });

    it("flags git-destructive forms", () => {
      expect(isDestructiveCommand("git reset --hard HEAD~5")).toBe(true);
      expect(isDestructiveCommand("git push --force origin main")).toBe(true);
      expect(isDestructiveCommand("git push -f")).toBe(true);
      expect(isDestructiveCommand("git branch -D feature/x")).toBe(true);
    });

    it("flags sudo regardless of subcommand", () => {
      expect(isDestructiveCommand("sudo apt-get install vim")).toBe(true);
    });

    it("flags reboot / shutdown / killall", () => {
      expect(isDestructiveCommand("shutdown -h now")).toBe(true);
      expect(isDestructiveCommand("reboot")).toBe(true);
      expect(isDestructiveCommand("killall node")).toBe(true);
    });

    it("flags SQL destructive verbs", () => {
      expect(isDestructiveCommand("DROP TABLE users")).toBe(true);
      expect(isDestructiveCommand("TRUNCATE TABLE logs")).toBe(true);
      expect(isDestructiveCommand("DELETE FROM accounts WHERE 1=1")).toBe(true);
    });

    it("does NOT flag benign commands", () => {
      expect(isDestructiveCommand("ls -la")).toBe(false);
      expect(isDestructiveCommand("npm install")).toBe(false);
      expect(isDestructiveCommand("git status")).toBe(false);
      expect(isDestructiveCommand("cat README.md")).toBe(false);
    });

    it("returns false on empty input", () => {
      expect(isDestructiveCommand("")).toBe(false);
      expect(isDestructiveCommand(null as any)).toBe(false);
    });
  });
});
