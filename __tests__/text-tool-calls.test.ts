import { describe, it, expect } from "vitest";
import {
  parseTextToolCalls,
  extractJsonSnippets,
  repairStringWrappedJson,
} from "../src/lib/agent/text-tool-calls";

const known = (n: string) =>
  ["pi_code", "schedule_task", "spawn_subagents_parallel", "spawn_subagents_sequential", "spawn_agents", "web_research", "memory"].includes(n);

describe("extractJsonSnippets", () => {
  it("extracts a balanced object ignoring braces inside strings", () => {
    expect(extractJsonSnippets('prefix {"a": "b}c"} suffix')).toEqual(['{"a": "b}c"}']);
  });
  it("extracts multiple snippets", () => {
    expect(extractJsonSnippets('{"a":1} and [{"b":2}]')).toEqual(['{"a":1}', '[{"b":2}]']);
  });
});

describe("parseTextToolCalls", () => {
  it("recovers a bare JSON tool call (the pi_code leak)", () => {
    const text = '{"name": "pi_code", "parameters": {"operation": "run", "cwd": "/Users/x"}}';
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("pi_code");
    expect(calls[0].arguments).toEqual({ operation: "run", cwd: "/Users/x" });
  });

  it("recovers a call with a prose preamble", () => {
    const text = "Here's a JSON object for a function call:\n\n{\"name\": \"pi_code\", \"parameters\": {\"operation\": \"run\"}}";
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("pi_code");
  });

  it("resolves a common alias ('scheduler' → schedule_task)", () => {
    const text = '{"name": "scheduler", "parameters": {"operation": "create", "schedule": "in 4 minutes", "prompt": "Drink water"}}';
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("schedule_task");
  });

  it("recovers a code-fenced tool call", () => {
    const text = '```json\n{"name":"web_research","arguments":{"query":"Cambridge MBA"}}\n```';
    const calls = parseTextToolCalls(text, known);
    expect(calls[0]).toMatchObject({ name: "web_research", arguments: { query: "Cambridge MBA" } });
  });

  it("recovers an array of calls (e.g. a batch spawn)", () => {
    const text = '[{"name":"spawn_subagents_parallel","parameters":{"n":3}},{"tool":"memory","input":{"operation":"read"}}]';
    const calls = parseTextToolCalls(text, known);
    expect(calls.map((c) => c.name)).toEqual(["spawn_subagents_parallel", "memory"]);
  });

  it("coerces stringified arguments", () => {
    const text = '{"name":"memory","arguments":"{\\"operation\\":\\"read\\"}"}';
    expect(parseTextToolCalls(text, known)[0].arguments).toEqual({ operation: "read" });
  });

  it("ignores ordinary prose and unknown tools", () => {
    expect(parseTextToolCalls("The Cambridge MBA is a one-year program.", known)).toHaveLength(0);
    expect(parseTextToolCalls('{"name":"not_a_tool","parameters":{}}', known)).toHaveLength(0);
  });

  it("ignores empty input", () => {
    expect(parseTextToolCalls("", known)).toHaveLength(0);
  });

  // Regression: the exact payload Sora dumped into chat on 2026-07-18. The
  // model quote-wrapped the batch array WITHOUT escaping the inner quotes,
  // producing invalid JSON that the parser previously discarded silently.
  it("recovers the malformed quote-wrapped batch spawn (Sora job-search leak)", () => {
    const text =
      '{"name": "spawn_subagents_parallel", "parameters": {"batch": "[' +
      '{"goal": "Find 5 relevant jobs for top application", "persona_id": "none", "allowed_tools": ["web_research", "read_secure_webpage", "browse_session", "recall", "pi_code"], "timeout_seconds": 180}, ' +
      '{"goal": "Search jobs on job boards", "persona_id": "none", "allowed_tools": ["web_search", "spreadsheet"], "timeout_seconds": 180}, ' +
      '{"goal": "Check company websites for job openings", "persona_id": "none", "allowed_tools": ["web_research", "read_secure_webpage", "browse_session"], "timeout_seconds": 180}, ' +
      '{"goal": "Network with professionals in the industry", "persona_id": "none", "allowed_tools": ["recall", "pi_code", "spreadsheet"], "timeout_seconds": 180}, ' +
      '{"goal": "Research company culture and reviews", "persona_id": "none", "allowed_tools": ["web_research", "read_secure_webpage", "browse_session"], "timeout_seconds": 180}]"}}';
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("spawn_subagents_parallel");
    const batch = calls[0].arguments.batch as Array<{ goal: string; timeout_seconds: number }>;
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(5);
    expect(batch[0].goal).toBe("Find 5 relevant jobs for top application");
    expect(batch[4].timeout_seconds).toBe(180);
  });

  it("recovers the malformed payload even with trailing UI cruft", () => {
    const text =
      'Sure — spawning agents now:\n{"name": "spawn_subagents_parallel", "parameters": {"batch": "[{"goal": "Find jobs"}]"}}\n\nCopy';
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments.batch).toEqual([{ goal: "Find jobs" }]);
  });
  it("recovers the truncated sequential-ask dump and remaps parallel → sequential", () => {
    // Exact (mangled) payload Sora dumped when the user asked for sequential:
    // truncated array, Python-style allowed_tools, wrong tool name.
    const text =
      'can we do this sequentially, ask one agent to find the most relevant job and then next agent and so on\n' +
      '{"name": "spawn_subagents_parallel", "parameters": {"batch": "[{"allowed_tools": "[' +
      "'devpm_codebase', 'pi_code']\", \"goal\": \"Find most relevant job for Senior AI PM role\", " +
      '"persona_id": "persona-devpm", "timeout_seconds": 300}"}}';
    const calls = parseTextToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("spawn_subagents_sequential");
    const batch = calls[0].arguments.batch as Array<{
      goal: string;
      persona_id?: string;
      timeout_seconds?: number;
      allowed_tools?: string[];
    }>;
    expect(batch).toHaveLength(1);
    expect(batch[0].goal).toBe("Find most relevant job for Senior AI PM role");
    expect(batch[0].persona_id).toBe("persona-devpm");
    expect(batch[0].timeout_seconds).toBe(300);
    expect(batch[0].allowed_tools).toEqual(["devpm_codebase", "pi_code"]);
  });

  it("remaps parallel → sequential when prose asks for one-then-next even on valid JSON", () => {
    const text =
      "Do it one at a time then the next:\n" +
      '{"name":"spawn_subagents_parallel","parameters":{"batch":[{"goal":"a"},{"goal":"b"}]}}';
    const calls = parseTextToolCalls(text, known);
    expect(calls[0].name).toBe("spawn_subagents_sequential");
    expect(calls[0].arguments.batch).toHaveLength(2);
  });
});

describe("coerceStringList", () => {
  it("parses JSON arrays and Python-ish single-quoted lists", async () => {
    const { coerceStringList } = await import("../src/lib/agent/text-tool-calls");
    expect(coerceStringList(["a", "b"])).toEqual(["a", "b"]);
    expect(coerceStringList('["a","b"]')).toEqual(["a", "b"]);
    expect(coerceStringList("['devpm_codebase', 'pi_code']")).toEqual(["devpm_codebase", "pi_code"]);
  });
});

describe("repairStringWrappedJson", () => {
  it("unwraps a quote-wrapped array value with unescaped inner quotes", () => {
    const bad = '{"batch": "[{"goal": "x"}]"}';
    expect(JSON.parse(repairStringWrappedJson(bad))).toEqual({ batch: [{ goal: "x" }] });
  });

  it("unwraps a quote-wrapped object value", () => {
    const bad = '{"config": "{"a": 1}"}';
    expect(JSON.parse(repairStringWrappedJson(bad))).toEqual({ config: { a: 1 } });
  });

  it("leaves properly-escaped stringified JSON alone", () => {
    const good = '{"batch":"[{\\"goal\\":\\"x\\"}]"}';
    expect(repairStringWrappedJson(good)).toBe(good);
  });

  it("leaves ordinary valid JSON alone", () => {
    const good = '{"a": [1, 2], "b": {"c": "d"}}';
    expect(repairStringWrappedJson(good)).toBe(good);
  });

  it("leaves plain prose alone", () => {
    const prose = 'She said: "hello [world]" and left.';
    expect(repairStringWrappedJson(prose)).toBe(prose);
  });
});
