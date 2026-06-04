/**
 * Signed envelope for cross-node communication.
 *
 * Every peer-to-peer message — capability advertisements, task delegations,
 * audit verification queries, knowledge queries — is wrapped in this envelope
 * before transmission. The receiver verifies:
 *
 *   1. The signature matches the claimed sender's recorded public key.
 *   2. The envelope hasn't been replayed (lamport counter must advance).
 *   3. The recipient field matches this node (prevents wrong-node delivery).
 *   4. The timestamp is within a reasonable window (defence against very old
 *      replayed envelopes; not a security guarantee on its own — the lamport
 *      check is the real anti-replay).
 *
 * The payload is canonicalised (sorted-key JSON) before signing so two
 * encoders that produce equivalent JSON still verify against the same
 * signature.
 */

import crypto, { KeyObject } from "crypto";
import { getIdentity, parsePeerPublicKey, fingerprintOfPubkey } from "./identity";
import { tick, observe } from "./clock";

const ENVELOPE_VERSION = 1;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000; // 24h — generous; lamport is the real check.

export type EnvelopeKind =
  // Request kinds
  | "capabilities"
  | "capabilities-pull"
  | "delegate"
  | "audit-query"
  | "knowledge-query"
  | "knowledge-fetch"
  | "pair-request"
  | "pair-confirm"
  // Response kinds — the server wraps every reply as `${request}-result`
  | "capabilities-result"
  | "capabilities-pull-result"
  | "delegate-result"
  | "audit-query-result"
  | "audit-response"
  | "knowledge-query-result"
  | "knowledge-fetch-result"
  | "knowledge-response"
  | "pair-request-result"
  | "pair-confirm-result";

export type SignedEnvelope<P = unknown> = {
  v: number;                 // envelope version
  kind: EnvelopeKind;
  sender: string;            // sender's node_id (fingerprint)
  recipient: string;         // recipient's node_id (or "*" for broadcast)
  lamport: number;           // sender's Lamport counter at send time
  ts: number;                // sender's wall-clock ms (advisory)
  payload: P;
  sig: string;               // base64 of Ed25519 signature over the canonical body
};

/**
 * Deterministic JSON serialisation: object keys recursively sorted. This is
 * what we sign and verify, so two implementations cannot disagree on the bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}

/** The bytes that get signed — everything except the signature itself. */
function signableBytes(env: Omit<SignedEnvelope, "sig">): Buffer {
  return Buffer.from(canonicalJson(env), "utf8");
}

/** Build, sign, and return a SignedEnvelope addressed to `recipient`. */
export function sign<P>(
  kind: EnvelopeKind,
  recipient: string,
  payload: P
): SignedEnvelope<P> {
  const { identity, privKey } = getIdentity();
  const unsigned: Omit<SignedEnvelope<P>, "sig"> = {
    v: ENVELOPE_VERSION,
    kind,
    sender: identity.node_id,
    recipient,
    lamport: tick(),
    ts: Date.now(),
    payload,
  };
  const sig = crypto.sign(null, signableBytes(unsigned), privKey).toString("base64");
  return { ...unsigned, sig };
}

export type VerifyOptions = {
  /** PEM of the sender's public key, retrieved from `fleet_peers` */
  senderPubkeyPem: string;
  /** Expected recipient — usually this node's id. Pass "*" to accept broadcasts. */
  expectedRecipient: string;
  /** Optionally skip the timestamp window check (e.g. clock skew on first pair) */
  allowClockSkew?: boolean;
};

export type VerifyResult<P = unknown> =
  | { ok: true; envelope: SignedEnvelope<P> }
  | { ok: false; reason: string };

/**
 * Verify a received envelope. On success, advances the local Lamport clock
 * past the sender's value so any local event recorded next will be ordered
 * after the received one.
 *
 * On failure, returns a structured reason. Callers should treat every failure
 * as a security event and log it to the audit log.
 */
export function verify<P>(env: SignedEnvelope<P>, opts: VerifyOptions): VerifyResult<P> {
  if (env.v !== ENVELOPE_VERSION) {
    return { ok: false, reason: `Unsupported envelope version ${env.v}` };
  }
  if (env.recipient !== opts.expectedRecipient && opts.expectedRecipient !== "*") {
    return { ok: false, reason: `Envelope addressed to ${env.recipient}, expected ${opts.expectedRecipient}` };
  }

  let pubKey: KeyObject;
  try {
    pubKey = parsePeerPublicKey(opts.senderPubkeyPem);
  } catch {
    return { ok: false, reason: "Sender public key is malformed" };
  }

  // Confirm the claimed sender matches the public key we're verifying against.
  const claimedFp = fingerprintOfPubkey(opts.senderPubkeyPem);
  if (env.sender !== claimedFp) {
    return { ok: false, reason: `Sender field ${env.sender} does not match the public key fingerprint ${claimedFp}` };
  }

  // Strip sig before computing the signed bytes.
  const { sig, ...rest } = env;
  const sigBuf = Buffer.from(sig, "base64");
  let ok = false;
  try {
    ok = crypto.verify(null, signableBytes(rest as Omit<SignedEnvelope, "sig">), pubKey, sigBuf);
  } catch {
    return { ok: false, reason: "Signature verification threw — malformed signature bytes" };
  }
  if (!ok) return { ok: false, reason: "Signature did not verify" };

  // Clock skew is a soft check — Lamport ordering is the real anti-replay.
  if (!opts.allowClockSkew) {
    const skew = Math.abs(Date.now() - env.ts);
    if (skew > MAX_CLOCK_SKEW_MS) {
      return { ok: false, reason: `Wall-clock skew of ${Math.round(skew / 1000)}s exceeds limit` };
    }
  }

  // Advance the local clock past the received lamport value.
  observe(env.lamport);
  return { ok: true, envelope: env };
}
