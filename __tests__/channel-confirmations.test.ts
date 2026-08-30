import { describe, it, expect } from "vitest";
import {
  tryChannelConfirmation,
  submitConfirmation,
  awaitConfirmation,
} from "../src/lib/agent/confirmations";

describe("channel confirmations", () => {
  it("resolves YES/NO replies for a pending channel confirmation", async () => {
    const channelKey = "telegram:user-1";
    const promise = awaitConfirmation("tc-1", 5000, false, {
      channelKey,
      preview: "Send email to bob@example.com",
    });

    expect(tryChannelConfirmation(channelKey, "hello")).toEqual({ handled: false });

    const handled = tryChannelConfirmation(channelKey, "YES");
    expect(handled.handled).toBe(true);
    expect(handled.decision).toBe("allow");

    await expect(promise).resolves.toBe("allow");
  });

  it("denies on NO reply", async () => {
    const channelKey = "sms:user-2";
    const promise = awaitConfirmation("tc-2", 5000, false, { channelKey, preview: "Delete file" });
    tryChannelConfirmation(channelKey, "no thanks");
    await expect(promise).resolves.toBe("deny");
  });

  it("never lets a plaintext YES unlock a PIN-gated confirmation", async () => {
    const channelKey = "telegram:user-3";
    const promise = awaitConfirmation("tc-pin", 5000, true, {
      channelKey,
      preview: "Send wire transfer",
    });
    const handled = tryChannelConfirmation(channelKey, "YES");
    expect(handled).toEqual({
      handled: true,
      decision: "deny",
      preview: "Send wire transfer",
    });
    await expect(promise).resolves.toBe("deny");
  });

  it("submitConfirmation works for browser UI path", async () => {
    const promise = awaitConfirmation("tc-3", 5000, false);
    expect(submitConfirmation("tc-3", "allow")).toBe(true);
    await expect(promise).resolves.toBe("allow");
  });
});
