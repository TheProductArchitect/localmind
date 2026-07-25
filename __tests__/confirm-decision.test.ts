/**
 * Unit tests for M5 remote confirm-decision handler + initiator.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

const peers: Record<string, any> = {};
let settings: { pin_hash: string | null } = { pin_hash: null };

vi.mock("../src/lib/db/fleet", () => ({
  getPeer: (id: string) => peers[id] || null,
}));

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => settings,
}));

vi.mock("../src/lib/fleet/peer-client", () => ({
  sendToPeer: vi.fn(),
}));

import { handleConfirmDecision } from "../src/lib/fleet/handlers/confirm-decision";
import { sendConfirmDecisionToPeer } from "../src/lib/fleet/confirm-decision-initiator";
import { awaitConfirmation } from "../src/lib/agent/confirmations";
import { sendToPeer } from "../src/lib/fleet/peer-client";

function envelope(payload: any) {
  return {
    v: 1,
    kind: "confirm-decision",
    sender: "peer-a",
    recipient: "me",
    lamport: 1,
    ts: Date.now(),
    payload,
    sig: "sig",
  } as any;
}

describe("handleConfirmDecision", () => {
  beforeEach(() => {
    for (const k of Object.keys(peers)) delete peers[k];
    peers["peer-a"] = { peer_node_id: "peer-a", trusted: 1 };
    settings = { pin_hash: null };
  });

  it("refuses an untrusted peer", async () => {
    peers["peer-a"].trusted = 0;
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-1", decision: "allow" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not trusted/i);
  });

  it("rejects an invalid payload", async () => {
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "", decision: "allow" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid/i);
  });

  it("returns unmatched when no pending confirmation exists", async () => {
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "missing-id", decision: "deny" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.matched).toBe(false);
    expect(r.error).toMatch(/no pending/i);
  });

  it("resolves a pending ask-tier confirmation (integration with awaitConfirmation)", async () => {
    const promise = awaitConfirmation("tc-remote-1", 5_000, false);
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-remote-1", decision: "allow" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(true);
    await expect(promise).resolves.toBe("allow");
  });

  it("denies a pending confirmation", async () => {
    const promise = awaitConfirmation("tc-remote-2", 5_000, false);
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-remote-2", decision: "deny" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(true);
    await expect(promise).resolves.toBe("deny");
  });

  it("requires a PIN for pin-tier allow decisions", async () => {
    settings = { pin_hash: await bcrypt.hash("1234", 4) };
    const promise = awaitConfirmation("tc-pin-1", 5_000, true);
    const missing = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-pin-1", decision: "allow" }),
      senderNodeId: "peer-a",
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/pin is required/i);

    const wrong = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-pin-1", decision: "allow", pin: "9999" }),
      senderNodeId: "peer-a",
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toMatch(/incorrect pin/i);

    const ok = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-pin-1", decision: "allow", pin: "1234" }),
      senderNodeId: "peer-a",
    });
    expect(ok.ok).toBe(true);
    expect(ok.matched).toBe(true);
    await expect(promise).resolves.toBe("allow");
  });

  it("allows pin-tier deny without a PIN", async () => {
    settings = { pin_hash: await bcrypt.hash("1234", 4) };
    const promise = awaitConfirmation("tc-pin-2", 5_000, true);
    const r = await handleConfirmDecision({
      envelope: envelope({ tool_call_id: "tc-pin-2", decision: "deny" }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(true);
    await expect(promise).resolves.toBe("deny");
  });
});

describe("sendConfirmDecisionToPeer", () => {
  beforeEach(() => {
    vi.mocked(sendToPeer).mockReset();
  });

  it("forwards the decision envelope to the peer", async () => {
    vi.mocked(sendToPeer).mockResolvedValue({
      ok: true,
      envelope: {
        payload: { ok: true, matched: true },
        sig: "s",
        lamport: 1,
      },
    } as any);

    const r = await sendConfirmDecisionToPeer({
      peer_node_id: "spark",
      tool_call_id: "tc-9",
      decision: "allow",
      pin: "1234",
    });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(true);
    expect(sendToPeer).toHaveBeenCalledWith(
      "spark",
      "confirm-decision",
      { tool_call_id: "tc-9", decision: "allow", pin: "1234" },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it("surfaces RPC failures", async () => {
    vi.mocked(sendToPeer).mockResolvedValue({
      ok: false,
      status: 0,
      reason: "timeout",
    });
    const r = await sendConfirmDecisionToPeer({
      peer_node_id: "spark",
      tool_call_id: "tc-9",
      decision: "deny",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
  });
});
