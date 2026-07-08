import { describe, it, expect } from "vitest";
import {
  parseManualOverride,
  inferTaskType,
  inferRequiredTools,
  buildRoutingContext,
} from "../src/lib/agent/routing";

describe("agent routing heuristics", () => {
  it("parses @AgentName manual override", () => {
    expect(parseManualOverride("@DevPM fix the bug")).toBe("DevPM");
    expect(parseManualOverride("hello @DevPM")).toBeNull();
  });

  it("infers task types from message content", () => {
    expect(inferTaskType("implement the auth module in typescript")).toBe("code");
    expect(inferTaskType("search the web for latest AI news")).toBe("research");
    expect(inferTaskType("hi")).toBe("quick_lookup");
  });

  it("infers required tools from message content", () => {
    const tools = inferRequiredTools("check my calendar and send an email");
    expect(tools).toContain("calendar");
    expect(tools).toContain("email");
  });

  it("builds a routing context with manual override", () => {
    const ctx = buildRoutingContext("@Researcher find and summarize the latest research papers on RAG retrieval", "persona-general");
    expect(ctx.manual_override_agent).toBe("Researcher");
    expect(ctx.active_persona).toBe("persona-general");
    expect(ctx.task_type).toBe("research");
  });
});
