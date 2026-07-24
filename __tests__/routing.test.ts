import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseManualOverride,
  inferTaskType,
  inferRequiredTools,
  buildRoutingContext,
  resolveRoutedModel,
} from "../src/lib/agent/routing";

vi.mock("../src/lib/db/routing-rules", () => ({
  evaluateRules: vi.fn(),
}));
vi.mock("../src/lib/db/personas", () => ({
  listPersonas: vi.fn(() => [
    { persona_id: "agent-researcher", name: "Researcher", model_name: null, provider: null },
    { persona_id: "agent-coder", name: "Coder", model_name: "qwen2.5-coder:latest", provider: "ollama" },
    { persona_id: "agent-claude", name: "ClaudeCoder", model_name: "claude-sonnet-4-6", provider: "anthropic" },
  ]),
}));

import { evaluateRules } from "../src/lib/db/routing-rules";

describe("agent routing heuristics", () => {
  beforeEach(() => {
    vi.mocked(evaluateRules).mockReset();
  });

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

  it("routes concrete URLs to page readers, not filesystem", () => {
    const tools = inferRequiredTools("download the report from https://report.technation.io/");
    expect(tools).toContain("read_secure_webpage");
    expect(tools).toContain("web_research");
    expect(tools).not.toContain("filesystem");
  });

  it("builds a routing context with manual override", () => {
    const ctx = buildRoutingContext("@Researcher find and summarize the latest research papers on RAG retrieval", "persona-general");
    expect(ctx.manual_override_agent).toBe("Researcher");
    expect(ctx.active_persona).toBe("persona-general");
    expect(ctx.task_type).toBe("research");
  });

  it("falls back to the default model for an unmatched agent label like Research", () => {
    vi.mocked(evaluateRules).mockReturnValue({
      rule_id: "rule-1",
      target_agent_name: "Research",
    } as any);
    const routed = resolveRoutedModel("what's the latest news", "llama3.2:latest");
    expect(routed.model).toBe("llama3.2:latest");
    expect(routed.matchedAgent).toBe("Researcher");
  });

  it("uses a persona model when the target agent has one configured", () => {
    vi.mocked(evaluateRules).mockReturnValue({
      rule_id: "rule-2",
      target_agent_name: "Coder",
    } as any);
    const routed = resolveRoutedModel("fix this typescript bug", "llama3.2:latest");
    expect(routed.model).toBe("qwen2.5-coder:latest");
    expect(routed.matchedAgent).toBe("Coder");
  });

  it("treats explicit model ids as model names", () => {
    vi.mocked(evaluateRules).mockReturnValue({
      rule_id: "rule-3",
      target_agent_name: "llama3.2:latest",
    } as any);
    const routed = resolveRoutedModel("hi", "other", null, "ollama");
    expect(routed.model).toBe("llama3.2:latest");
    expect(routed.provider).toBe("ollama");
  });

  it("returns persona provider+model pair", () => {
    vi.mocked(evaluateRules).mockReturnValue({
      rule_id: "rule-4",
      target_agent_name: "ClaudeCoder",
    } as any);
    const routed = resolveRoutedModel("refactor auth", "llama3.2:latest", null, "ollama");
    expect(routed.model).toBe("claude-sonnet-4-6");
    expect(routed.provider).toBe("anthropic");
    expect(routed.matchedAgent).toBe("ClaudeCoder");
  });

  it("parses provider/model target ids", () => {
    vi.mocked(evaluateRules).mockReturnValue({
      rule_id: "rule-5",
      target_agent_name: "gemini/gemini-2.5-flash",
    } as any);
    const routed = resolveRoutedModel("quick question", "llama3.2:latest", null, "ollama");
    expect(routed.provider).toBe("gemini");
    expect(routed.model).toBe("gemini-2.5-flash");
  });
});
