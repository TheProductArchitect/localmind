/**
 * Unit tests for NDJSON keepalive frames used during long fleet confirm waits.
 */

import { describe, it, expect } from "vitest";

/** Mirrors peer-client handling: ping frames refresh idle timeout and are not UI events. */
function classifyNdjsonControl(frame: { type?: string }): "keepalive" | "control" | "token" | "result" | "other" {
  if (frame.type === "ping") return "keepalive";
  if (frame.type === "token") return "token";
  if (frame.type === "result") return "result";
  if (frame.type === "confirm" || frame.type === "confirm_timeout" || frame.type === "confirm_denied") {
    return "control";
  }
  return "other";
}

describe("fleet NDJSON keepalive", () => {
  it("treats ping as keepalive (not a UI control frame)", () => {
    expect(classifyNdjsonControl({ type: "ping" })).toBe("keepalive");
    expect(classifyNdjsonControl({ type: "confirm" })).toBe("control");
    expect(classifyNdjsonControl({ type: "token" })).toBe("token");
    expect(classifyNdjsonControl({ type: "result" })).toBe("result");
  });

  it("confirmation frames remain distinct control events", () => {
    expect(classifyNdjsonControl({ type: "confirm_timeout" })).toBe("control");
    expect(classifyNdjsonControl({ type: "confirm_denied" })).toBe("control");
  });
});
