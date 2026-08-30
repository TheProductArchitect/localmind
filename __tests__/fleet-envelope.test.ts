import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "crypto";
import { fingerprintOfPubkey } from "../src/lib/fleet/identity";

// Setup mock keypair for the local identity
const localKp = generateKeyPairSync("ed25519");
const localPrivPem = localKp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const localPubPem = localKp.publicKey.export({ type: "spki", format: "pem" }) as string;
const localPrivKey = createPrivateKey({ key: localPrivPem, format: "pem" });
const localPubKey = createPublicKey({ key: localPubPem, format: "pem" });
const localNodeId = fingerprintOfPubkey(localPubPem);

let clockCounter = 1;

vi.mock("../src/lib/fleet/identity", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/fleet/identity")>("../src/lib/fleet/identity");
  return {
    ...actual,
    getIdentity: vi.fn(() => ({
      identity: {
        node_id: localNodeId,
        pubkey_pem: localPubPem,
        privkey_path: "/mock/node.key",
        created_at: 1000,
      },
      privKey: localPrivKey,
      pubKey: localPubKey,
    })),
    getNodeIdentity: vi.fn(() => ({
      node_id: localNodeId,
      pubkey_pem: localPubPem,
      privkey_path: "/mock/node.key",
      created_at: 1000,
    })),
  };
});

vi.mock("../src/lib/fleet/clock", () => ({
  tick: vi.fn(() => ++clockCounter),
  observe: vi.fn((incoming: number) => {
    clockCounter = Math.max(clockCounter, incoming) + 1;
    return clockCounter;
  }),
  peek: vi.fn(() => clockCounter),
}));

import { sign, verify } from "../src/lib/fleet/envelope";

describe("fleet envelope signing and verification", () => {
  beforeEach(() => {
    clockCounter = 1;
  });

  it("verifies a signed envelope when public key matches private key", () => {
    const payload = {
      pairing_token: "pair-token-abc",
      node_id: localNodeId,
      pubkey_pem: localPubPem,
    };

    const envelope = sign("pair-confirm", "peer-node-123", payload);

    const result = verify(envelope, {
      senderPubkeyPem: localPubPem,
      expectedRecipient: "peer-node-123",
      allowClockSkew: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.kind).toBe("pair-confirm");
      expect(result.envelope.sender).toBe(localNodeId);
      expect(result.envelope.payload).toEqual(payload);
    }
  });

  it("rejects envelope verification when sender public key does not match sender node_id", () => {
    const wrongKp = generateKeyPairSync("ed25519");
    const wrongPubPem = wrongKp.publicKey.export({ type: "spki", format: "pem" }) as string;

    const payload = { test: "data" };
    const envelope = sign("capabilities", "peer-node-123", payload);

    const result = verify(envelope, {
      senderPubkeyPem: wrongPubPem,
      expectedRecipient: "peer-node-123",
      allowClockSkew: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("does not match the public key fingerprint");
    }
  });

  it("rejects envelope verification when envelope payload is tampered with", () => {
    const envelope = sign("capabilities", "peer-node-123", { count: 1 });
    // Tamper with payload after signing
    (envelope.payload as { count: number }).count = 999;

    const result = verify(envelope, {
      senderPubkeyPem: localPubPem,
      expectedRecipient: "peer-node-123",
      allowClockSkew: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("Signature did not verify");
    }
  });

  it("rejects envelope verification when recipient does not match", () => {
    const envelope = sign("capabilities", "peer-node-123", { ping: true });

    const result = verify(envelope, {
      senderPubkeyPem: localPubPem,
      expectedRecipient: "wrong-recipient-node",
      allowClockSkew: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Envelope addressed to");
    }
  });
});
