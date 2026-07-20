import { describe, it, expect } from "vitest";
import { parseRefuteResponse } from "../src/lib/graph/refute";

describe("refute response parsing", () => {
  it("parses a valid refute verdict", () => {
    const result = parseRefuteResponse('Analysis complete.\n{ "refuted": false, "reason": "" }');
    expect(result.refuted).toBe(false);
  });

  it("defaults to refuted when no JSON verdict", () => {
    const result = parseRefuteResponse("I could not decide.");
    expect(result.refuted).toBe(true);
  });

  it("parses refuted=true with reason", () => {
    const result = parseRefuteResponse('{ "refuted": true, "reason": "Output contradicts contract" }');
    expect(result.refuted).toBe(true);
    expect(result.reason).toContain("contradicts");
  });
});
