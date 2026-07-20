import { describe, it, expect, vi, beforeEach } from "vitest";

const { runAppleScript } = vi.hoisted(() => ({
  runAppleScript: vi.fn(async (_script: string) => ""),
}));
vi.mock("../src/lib/tools/applescript", () => ({ runAppleScript }));

import { macAutomationTool } from "../src/lib/tools/mac-automation";

const ctx = {} as any;

// Removes escaped sequences (`\\` then `\"`) and counts the double quotes that
// remain. Those are exactly the structural quotes of the AppleScript template;
// any user-injected quote would have been escaped away. If the count exceeds
// the template's own quotes, a breakout slipped through.
function structuralQuoteCount(script: string): number {
  const stripped = script.replace(/\\\\/g, "").replace(/\\"/g, "");
  return (stripped.match(/"/g) || []).length;
}

describe("mac_automation AppleScript escaping", () => {
  beforeEach(() => runAppleScript.mockClear());

  it("neutralises a trailing-backslash breakout in app names", async () => {
    await macAutomationTool.execute(
      { operation: "open_app", app: 'Calculator\\" \n do shell script "touch /tmp/pwned' },
      ctx
    );
    const script = runAppleScript.mock.calls[0][0];
    expect(script).not.toMatch(/[\r\n]/);
    // `tell application "X" to activate` has exactly two structural quotes.
    expect(structuralQuoteCount(script)).toBe(2);
  });

  it("rejects non-http(s) URLs", async () => {
    const res = await macAutomationTool.execute(
      { operation: "open_url", url: "file:///etc/passwd" },
      ctx
    );
    expect(res.ok).toBe(false);
    expect(runAppleScript).not.toHaveBeenCalled();
  });

  it("escapes quotes and newlines in notifications", async () => {
    await macAutomationTool.execute(
      { operation: "notify", message: 'hi"\n with title "x" \n do shell script "id' },
      ctx
    );
    const script = runAppleScript.mock.calls[0][0];
    expect(script).not.toMatch(/[\r\n]/);
    // `display notification "…" with title "LocalMind"` has four structural quotes.
    expect(structuralQuoteCount(script)).toBe(4);
  });
});
