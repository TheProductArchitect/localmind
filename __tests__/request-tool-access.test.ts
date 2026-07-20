import { describe, it, expect } from "vitest";
import { requestToolAccessTool } from "../src/lib/tools/request-tool-access";

describe("request_tool_access input shapes", () => {
  it("accepts a real array", async () => {
    const r = await requestToolAccessTool.execute(
      { tools: ["email", "calendar"], reason: "Need to draft an invite" },
      { conversationId: "t", approvedDirs: [] }
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("email");
    expect(r.output).toContain("<tool_access_request>");
  });

  it("accepts a stringified array from small models", async () => {
    const r = await requestToolAccessTool.execute(
      { tools: "['email', 'calendar']", reason: "Need to draft an invite" },
      { conversationId: "t", approvedDirs: [] }
    );
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/email/);
    expect(r.output).toMatch(/calendar/);
  });

  it("accepts comma-separated tool names", async () => {
    const r = await requestToolAccessTool.execute(
      { tools: "email, calendar", reason: "Need both" },
      { conversationId: "t", approvedDirs: [] }
    );
    expect(r.ok).toBe(true);
  });

  it("rejects empty tools", async () => {
    const r = await requestToolAccessTool.execute(
      { tools: [], reason: "x" },
      { conversationId: "t", approvedDirs: [] }
    );
    expect(r.ok).toBe(false);
  });
});
