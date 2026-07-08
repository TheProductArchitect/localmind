import { describe, it, expect } from "vitest";

/**
 * Unit-test the file_change trigger logic in isolation (no filesystem / DB).
 */
function fileChangeTriggered(
  lastMtime: number | null | undefined,
  currentMtime: number
): { triggered: boolean; nextBaseline: number } {
  const baseline = typeof lastMtime === "number" ? lastMtime : null;
  const triggered = baseline !== null && currentMtime > baseline;
  return { triggered, nextBaseline: currentMtime };
}

describe("file_change monitor logic", () => {
  it("does not trigger on first baseline (no prior mtime)", () => {
    expect(fileChangeTriggered(undefined, 1000)).toEqual({ triggered: false, nextBaseline: 1000 });
    expect(fileChangeTriggered(null, 1000)).toEqual({ triggered: false, nextBaseline: 1000 });
  });

  it("does not trigger when mtime unchanged", () => {
    expect(fileChangeTriggered(1000, 1000)).toEqual({ triggered: false, nextBaseline: 1000 });
  });

  it("triggers when mtime advances", () => {
    expect(fileChangeTriggered(1000, 2000)).toEqual({ triggered: true, nextBaseline: 2000 });
  });
});
