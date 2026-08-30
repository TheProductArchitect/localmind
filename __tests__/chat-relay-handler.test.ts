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

// Default fixture: a freshly-paired peer ("new" trust class). Individual
// tests override paired_at / last_seen_at to exercise established / active /
// idle-reconnect cases.
const peerRecord = {
  peer_node_id: "peer-A",
  pubkey_pem: "<test-key>",
  label: "DGX Spark",
  primary_addr: "192.168.1.20:7773",
  paired_at: Date.now() - 60_000,   // paired 1 min ago → "new"
  last_seen_at: Date.now() - 1_000, // seen 1s ago
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
    transaction: (fn: () => unknown) => fn,
  }),
}));

vi.mock("../src/lib/agent/engine", () => ({
  runAgent: async function* (_convId: string, message: string) {
    yield { type: "text_chunk", delta: `Echo: ${message}` };
  },
  runAgentCollect: vi.fn(async (_convId: string, message: string) => `Echo: ${message}`),
}));

import { handleChatRelay, markOutboundActive, clearOutboundActive, __resetChatRelayState, classifyPeerTrust } from "../src/lib/fleet/handlers/chat-relay";
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

  describe("smart rate limit (trust-class aware)", () => {
    it("classifyPeerTrust: established when paired > 7d AND seen ≤ 6h", () => {
      const now = Date.now();
      expect(classifyPeerTrust({ paired_at: now - 8 * 24 * 3600 * 1000, last_seen_at: now - 60_000 })).toBe("established");
    });

    it("classifyPeerTrust: active when paired > 24h AND seen ≤ 24h", () => {
      const now = Date.now();
      expect(classifyPeerTrust({ paired_at: now - 2 * 24 * 3600 * 1000, last_seen_at: now - 12 * 3600 * 1000 })).toBe("active");
    });

    it("classifyPeerTrust: new when freshly paired", () => {
      const now = Date.now();
      expect(classifyPeerTrust({ paired_at: now - 10_000, last_seen_at: now - 1000 })).toBe("new");
    });

    it("classifyPeerTrust: idle-reconnect when last seen > 24h ago", () => {
      const now = Date.now();
      expect(classifyPeerTrust({ paired_at: now - 10 * 24 * 3600 * 1000, last_seen_at: now - 48 * 3600 * 1000 })).toBe("idle-reconnect");
    });

    it("a 'new' peer admits up to base cap, then refuses", async () => {
      // Default fixture is "new". Base cap = 5 (policyOverride below).
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

    it("an 'established' peer bypasses the rate limit entirely", async () => {
      const now = Date.now();
      peerRecord.paired_at = now - 8 * 24 * 3600 * 1000;
      peerRecord.last_seen_at = now - 60_000;
      // 50 turns must all succeed — established peers get unlimited under
      // the user's "always connected → no rate limit" rule.
      for (let i = 0; i < 50; i++) {
        const r = await handleChatRelay({
          envelope: makeEnvelope(validPayload()),
          senderNodeId: "peer-A",
        });
        expect(r.ok, `turn ${i + 1}`).toBe(true);
      }
      // Restore for the next test
      peerRecord.paired_at = now - 60_000;
      peerRecord.last_seen_at = now - 1_000;
    });

    it("an 'idle-reconnect' peer is tightened to ~30% of base cap", async () => {
      const now = Date.now();
      peerRecord.paired_at = now - 10 * 24 * 3600 * 1000;
      peerRecord.last_seen_at = now - 48 * 3600 * 1000;
      // Base cap is 5; idle-reconnect cap = floor(5 * 0.3) = 1.
      const first = await handleChatRelay({ envelope: makeEnvelope(validPayload()), senderNodeId: "peer-A" });
      expect(first.ok).toBe(true);
      const second = await handleChatRelay({ envelope: makeEnvelope(validPayload()), senderNodeId: "peer-A" });
      expect(second.ok).toBe(false);
      expect(second.error).toMatch(/idle-reconnect/);
      peerRecord.paired_at = now - 60_000;
      peerRecord.last_seen_at = now - 1_000;
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
