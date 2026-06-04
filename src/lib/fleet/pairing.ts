/**
 * Pairing state — token issue, validation, consumption, expiry.
 *
 * Tokens live ONLY in memory. They're issued when the user clicks "Pair a new
 * device" and consumed exactly once when a `pair-confirm` envelope arrives
 * carrying the same token. They never touch disk so a leaked DB snapshot
 * can't be used to forge a pairing later.
 *
 * Default window: 5 minutes. After that the token is garbage-collected and a
 * pair-confirm referencing it gets rejected.
 *
 * The QR payload is what the initiator shows; the responder receives it
 * (scan or paste) and uses every field to send `pair-confirm` back over TLS.
 *
 * Security properties:
 *   - Token is the only secret in the protocol — exchanged via the QR / OOB
 *     channel (visual or copy-paste). An attacker who didn't read the QR
 *     cannot complete pairing.
 *   - QR carries the initiator's cert fingerprint so the responder pins it
 *     before the first call — no first-use-vulnerable cert exchange.
 *   - QR carries the initiator's pubkey so the responder can verify the
 *     final response envelope without a separate trust bootstrap.
 */

import crypto from "crypto";
import { getNodeIdentity, exportPublicKey } from "./identity";
import { getTlsMaterial } from "./tls";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_OPEN_WINDOWS = 8;             // bound RAM / brute-force surface

export type PairingPayload = {
  v: 1;
  node_id: string;
  pubkey_pem: string;
  cert_fingerprint_sha256: string;
  primary_addr: string;                  // host:port reachable from the responder
  pairing_token: string;                 // random, single-use
  issued_at: number;
  ttl_ms: number;
  label_hint?: string;                   // optional friendly name the initiator suggests
};

export type ActivePairing = {
  token: string;
  issued_at: number;
  expires_at: number;
  label_hint?: string;
  consumed_at?: number;
  consumed_by?: string;                  // responder node_id once confirmed
};

// Singleton across module reloads (Next dev module isolation).
type GlobalPairingState = {
  windows: Map<string, ActivePairing>;
};
const GLOBAL_KEY = Symbol.for("localmind.fleet.pairing");
const slot = globalThis as unknown as Record<symbol, GlobalPairingState>;
if (!slot[GLOBAL_KEY]) slot[GLOBAL_KEY] = { windows: new Map() };
const pairingState: GlobalPairingState = slot[GLOBAL_KEY];

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, w] of pairingState.windows) {
    if (w.expires_at < now) pairingState.windows.delete(token);
  }
}

/**
 * Open a new pairing window and return both the payload to encode in the QR
 * and the in-memory record. Caller is responsible for converting `payload`
 * into a QR image and / or displaying the JSON.
 */
export function openPairingWindow(opts: {
  primary_addr: string;
  ttl_ms?: number;
  label_hint?: string;
}): { payload: PairingPayload; window: ActivePairing } {
  purgeExpired();
  if (pairingState.windows.size >= MAX_OPEN_WINDOWS) {
    // Drop the oldest if we've hit the cap — keeps surface bounded without
    // blocking the user from initiating new pairings.
    const oldest = [...pairingState.windows.entries()].sort(
      (a, b) => a[1].issued_at - b[1].issued_at
    )[0];
    if (oldest) pairingState.windows.delete(oldest[0]);
  }

  const id = getNodeIdentity();
  const tls = getTlsMaterial();
  const token = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  const ttl = opts.ttl_ms ?? DEFAULT_TTL_MS;

  const w: ActivePairing = {
    token,
    issued_at: now,
    expires_at: now + ttl,
    label_hint: opts.label_hint,
  };
  pairingState.windows.set(token, w);

  const payload: PairingPayload = {
    v: 1,
    node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    cert_fingerprint_sha256: tls.fingerprint_sha256,
    primary_addr: opts.primary_addr,
    pairing_token: token,
    issued_at: now,
    ttl_ms: ttl,
    label_hint: opts.label_hint,
  };
  return { payload, window: w };
}

/** Encodes a payload for display. JSON is the wire format; the QR just visually wraps it. */
export function encodePayload(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

/** Parses + structurally validates a pasted/scanned payload. Doesn't trust contents — caller still verifies cryptographically. */
export function decodePayload(raw: string): { ok: true; payload: PairingPayload } | { ok: false; reason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "Pairing payload is not valid JSON." }; }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "Pairing payload is not an object." };
  const p = parsed as Partial<PairingPayload> & Record<string, unknown>;

  if (p.v !== 1) return { ok: false, reason: `Unsupported pairing payload version: ${p.v}` };
  for (const k of ["node_id", "pubkey_pem", "cert_fingerprint_sha256", "primary_addr", "pairing_token"]) {
    if (typeof p[k as keyof typeof p] !== "string" || !(p[k as keyof typeof p] as string).length) {
      return { ok: false, reason: `Pairing payload missing or empty field: ${k}` };
    }
  }
  if (typeof p.issued_at !== "number" || typeof p.ttl_ms !== "number") {
    return { ok: false, reason: "Pairing payload missing issued_at / ttl_ms" };
  }
  if (p.issued_at + p.ttl_ms < Date.now()) {
    return { ok: false, reason: "Pairing payload has expired — ask the other device for a fresh QR." };
  }
  if (!/^[0-9a-f]{64}$/i.test(p.cert_fingerprint_sha256 as string)) {
    return { ok: false, reason: "Cert fingerprint is not a valid SHA-256 hex string." };
  }
  return { ok: true, payload: p as PairingPayload };
}

/**
 * Consume a token (responder is calling back with pair-confirm). Returns the
 * window record on success. Single-use — a second call with the same token
 * returns null even if the window is otherwise valid.
 */
export function consumeToken(token: string, responderNodeId: string): ActivePairing | null {
  purgeExpired();
  const w = pairingState.windows.get(token);
  if (!w) return null;
  if (w.consumed_at) return null;
  if (w.expires_at < Date.now()) {
    pairingState.windows.delete(token);
    return null;
  }
  w.consumed_at = Date.now();
  w.consumed_by = responderNodeId;
  // We keep it around for a few seconds so a duplicate confirm doesn't 404
  // — second consumption still rejects via `consumed_at`. Final cleanup
  // happens on the next purge.
  setTimeout(() => pairingState.windows.delete(token), 10_000).unref?.();
  return w;
}

/** Visibility helper for the /fleet page. */
export function listOpenWindows(): ActivePairing[] {
  purgeExpired();
  return [...pairingState.windows.values()].filter((w) => !w.consumed_at);
}

/** Used by self-tests / explicit cancellation. */
export function cancelWindow(token: string): boolean {
  return pairingState.windows.delete(token);
}
