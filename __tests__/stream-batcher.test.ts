/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStreamBatcher } from "../src/lib/client/stream-batcher";

describe("createStreamBatcher", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0) as unknown as number
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces multiple pushes into one flush per frame", async () => {
    const flush = vi.fn();
    const batcher = createStreamBatcher(flush);
    batcher.push("Hel");
    batcher.push("lo");
    batcher.push("!");
    expect(flush).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("Hello!");
  });

  it("flushNow drains immediately and cancels the pending frame", async () => {
    const flush = vi.fn();
    const batcher = createStreamBatcher(flush);
    batcher.push("a");
    batcher.flushNow();
    expect(flush).toHaveBeenCalledWith("a");
    await new Promise((r) => setTimeout(r, 5));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("clear drops buffered text without flushing", async () => {
    const flush = vi.fn();
    const batcher = createStreamBatcher(flush);
    batcher.push("nope");
    batcher.clear();
    await new Promise((r) => setTimeout(r, 5));
    expect(flush).not.toHaveBeenCalled();
  });
});
