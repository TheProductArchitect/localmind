import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/lib/db/migrations";
import { piCodeTool } from "../src/lib/tools/pi-code";
import { macAutomationTool } from "../src/lib/tools/mac-automation";

describe("migration runner (MEDIUM)", () => {
  it("applies a late-inserted lower version that MAX(version) would have skipped", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS _schema (version INTEGER PRIMARY KEY)");
    // Simulate an install that somehow has v2 applied before v1 was recorded —
    // the old MAX(version) runner would skip v1 forever; the set-based runner must apply it.
    db.prepare("INSERT INTO _schema (version) VALUES (2)").run();
    // Use conversations migrations which are small; manually run the set-based logic
    // by calling runMigrations which will apply any missing versions.
    runMigrations(db, "conversations");
    const versions = (db.prepare("SELECT version FROM _schema ORDER BY version").all() as { version: number }[])
      .map((r) => r.version);
    expect(versions).toContain(1);
    expect(versions).toContain(2);
  });
});

describe("destructive floor for pi_code / mac_automation (MEDIUM)", () => {
  it("pi_code run classifies as destructive_shell", () => {
    expect(piCodeTool.classify?.({ operation: "run", goal: "fix", cwd: "/tmp" })).toBe("destructive_shell");
    expect(piCodeTool.classify?.({ operation: "status" })).toBe("read_files");
  });

  it("mac_automation escalates destructive payloads", () => {
    expect(macAutomationTool.classify?.({ operation: "notify", message: "hi" })).toBe("open_applications");
    expect(macAutomationTool.classify?.({ operation: "open_app", app: "Safari" })).toBe("open_applications");
    expect(macAutomationTool.classify?.({ operation: "open_app", app: "rm -rf /" })).toBe("destructive_shell");
  });
});
