import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The chat-relay handler is the inbound side of a peer driving a chat on us.
 * Even with mTLS and signed envelopes already verified by the dispatcher, the
 * handler MUST still enforce:
 *
 *   - capability gate (peer.policy.accept_chat_relay must be true)
 *   - rate limit (per-peer sliding window)
 *   - loop guard (refuse inbound from a peer we're currently driving)
 *   - payload validation (no empty / oversized messages)
 *
 * These tests pin those defenses. Bypassing any of them is a security regression.
 */

const peerRecord = {
  peer_node_id: "peer-A",
  pubkey_pem: "<test-key>",
  label: "DGX Spark",
  primary_addr: "192.168.1.20:7773",
  paired_at: 1,
  last_seen_at: 1,
  capabilities_json: "{}",
  policy_json: "{}",
  trusted: 1,
};
let policyOverride: Record<string, unknown> = {};

vi.mock("../src/lib/db/fleet", () => ({
  getPeer: vi.fn(() => peerRecord),
  parsePeerPolicy: vi.fn(() => ({
    allow_self_actions: false,
    allowed_tools: [],
    advertise_capabilities: true,
    accept_chat_relay: true,
    chat_relay_rate_per_min: 5,
    ...policyOverride,
  })),
}));

vi.mock("../src/lib/agent/audit-logger", () => ({
  logStartFederated: vi.fn(() => 42),
  logComplete: vi.fn(),
}));

vi.mock("../src/lib/db/queries", () => ({
  createConversation: vi.fn(() => ({ id: "conv-1" })),
  getConversation: vi.fn(() => ({ id: "conv-1" })),
}));

vi.mock("../src/lib/db", () => ({
  getConvDb: () => ({
    prepare: () => ({
      get: vi.fn(() => undefined),
      run: vi.fn(() => ({ changes: 1 })),
    }),
  }),
}));

vi.mock("../src/lib/agent/engine", () => ({
  runAgentCollect: vi.fn(async (_convId: string, message: string) => `Echo: ${message}`),
}));

import { handleChatRelay, markOutboundActive, clearOutboundActive, __resetChatRelayState } from "../src/lib/fleet/handlers/chat-relay";
import type { SignedEnvelope } from "../src/lib/fleet/envelope";

function makeEnvelope(payload: any): SignedEnvelope<any> {
  return {
    v: 1,
    kind: "chat-relay",
    sender: "peer-A",
    recipient: "self",
    lamport: 1,
    ts: Date.now(),
    payload,
    sig: "sig",
  };
}

const validPayload = () => ({
  initiator_audit_id: 7,
  initiator_conversation_id: "remote-conv-1",
  message: "How is the build going?",
});

describe("chat-relay handler", () => {
  beforeEach(() => {
    __resetChatRelayState();
    policyOverride = {};
  });

  describe("capability gate", () => {
    it("refuses when accept_chat_relay is false", async () => {
      policyOverride = { accept_chat_relay: false };
      const r = await handleChatRelay({
        envelope: makeEnvelope(validPayload()),
        senderNodeId: "peer-A",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not granted chat-relay/i);
    });

    it("accepts when accept_chat_relay is true", async () => {
      const r = await handleChatRelay({
        envelope: makeEnvelope(validPayload()),
        senderNodeId: "peer-A",
      });
      expect(r.ok).toBe(true);
      expect(r.reply).toContain("Echo:");
    });
  });

  describe("loop guard", () => {
    it("refuses inbound when we are currently driving the same peer outbound", async () => {
      markOutboundActive("peer-A");
      try {
        const r = await handleChatRelay({
          envelope: makeEnvelope(validPayload()),
          senderNodeId: "peer-A",
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/loop/i);
      } finally {
        clearOutboundActive("peer-A");
      }
    });

    it("does not refuse when the outbound is to a different peer", async () => {
      markOutboundActive("peer-B");
      try {
        const r = await handleChatRelay({
          envelope: makeEnvelope(validPayload()),
          senderNodeId: "peer-A",
        });
        expect(r.ok).toBe(true);
      } finally {
        clearOutboundActive("peer-B");
      }
    });
  });

  describe("rate limit", () => {
    it("admits up to chat_relay_rate_per_min in the window, then refuses", async () => {
      // Limit set to 5 in the policy mock above.
      for (let i = 0; i < 5; i++) {
        const r = await handleChatRelay({
          envelope: makeEnvelope(validPayload()),
          senderNodeId: "peer-A",
        });
        expect(r.ok, `request ${i + 1}`).toBe(true);
      }
      const sixth = await handleChatRelay({
        envelope: makeEnvelope(validPayload()),
        senderNodeId: "peer-A",
      });
      expect(sixth.ok).toBe(false);
      expect(sixth.error).toMatch(/rate limit/i);
    });
  });

  describe("payload validation", () => {
    it("refuses an empty message", async () => {
      const r = await handleChatRelay({
        envelope: makeEnvelope({ ...validPayload(), message: "   " }),
        senderNodeId: "peer-A",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/empty/i);
    });

    it("refuses a message exceeding 64 KiB", async () => {
      const huge = "x".repeat(64 * 1024 + 1);
      const r = await handleChatRelay({
        envelope: makeEnvelope({ ...validPayload(), message: huge }),
        senderNodeId: "peer-A",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/exceeds/i);
    });

    it("refuses without an initiator_conversation_id", async () => {
      const r = await handleChatRelay({
        envelope: makeEnvelope({ ...validPayload(), initiator_conversation_id: "" }),
        senderNodeId: "peer-A",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/initiator_conversation_id/i);
    });
  });
});
