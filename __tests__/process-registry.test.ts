import { describe, expect, it } from "vitest";
import {
  cancelProcess,
  isRegistered,
  pauseProcess,
  registerProcess,
  resumeProcess,
  unregisterProcess,
} from "../src/lib/agent/process-registry";

describe("process registry", () => {
  it("cancels a registered process via its AbortController", () => {
    const abort = new AbortController();
    registerProcess("p1", abort);
    expect(isRegistered("p1")).toBe(true);
    expect(cancelProcess("p1")).toBe(true);
    expect(abort.signal.aborted).toBe(true);
    unregisterProcess("p1");
    expect(isRegistered("p1")).toBe(false);
  });

  it("toggles pause so the agent loop can observe it between iterations", () => {
    const abort = new AbortController();
    const { paused } = registerProcess("p2", abort);
    expect(paused()).toBe(false);
    expect(pauseProcess("p2")).toBe(true);
    expect(paused()).toBe(true);
    expect(resumeProcess("p2")).toBe(true);
    expect(paused()).toBe(false);
    unregisterProcess("p2");
  });

  it("returns false for unknown process ids", () => {
    expect(cancelProcess("missing")).toBe(false);
    expect(pauseProcess("missing")).toBe(false);
    expect(resumeProcess("missing")).toBe(false);
  });
});
