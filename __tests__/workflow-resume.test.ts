import { describe, it, expect } from "vitest";

/** Mirrors workflow resume step index logic. */
function resumeStartStep(pausedStepIndex: number | null): number {
  return (pausedStepIndex ?? 0) + 1;
}

describe("workflow resume logic", () => {
  it("continues from the step after human_approval", () => {
    expect(resumeStartStep(3)).toBe(4);
  });

  it("defaults to step 1 when pause index missing", () => {
    expect(resumeStartStep(null)).toBe(1);
  });
});
