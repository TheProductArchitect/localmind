import { describe, it, expect } from "vitest";
import { parseTextToolCalls, extractJsonSnippets } from "../src/lib/agent/text-tool-calls";

const known = (n: string) =>
  ["pi_code", "schedule_task", "spawn_subagents_parallel", "web_research", "memory"].includes(n);

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
});
