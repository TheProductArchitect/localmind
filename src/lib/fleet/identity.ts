/**
 * Node identity — Ed25519 keypair generated once per LocalMind install.
 *
 * The public key fingerprint (SHA-256 of DER-encoded SPKI, base64url, 16 chars)
 * is the canonical `node_id` used everywhere a peer needs to reference this
 * machine. Private key is stored at `~/.localmind/keys/node.key` with mode 0600
 * inside a 0700 directory. The full public key (PEM) is also persisted to the
 * keys directory for easy export and is cached in the `node_identity` table.
 *
 * Decisions enforced here:
 *   - One identity per install, regenerated only on explicit reset.
 *   - Public key is shareable; private key never leaves disk.
 *   - All Ed25519 operations go through Node's built-in `crypto` — no extra deps.
 */

import crypto, {
  KeyObject,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "crypto";
import fs from "fs";
import { getConfigDb } from "../db";
import { ensureDataDir, NODE_PRIVKEY_FILE, NODE_PUBKEY_FILE } from "../paths";

export type NodeIdentity = {
  node_id: string;
  pubkey_pem: string;
  privkey_path: string;
  created_at: number;
};

let cached: { identity: NodeIdentity; privKey: KeyObject; pubKey: KeyObject } | null = null;

function fingerprint(pubKey: KeyObject): string {
  // SPKI bytes are the canonical public-key representation. Hashing those
  // gives a fingerprint that's identical regardless of PEM whitespace or
  // line endings.
  const spki = pubKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(spki).digest("base64url").slice(0, 16);
}

function loadFromDb(): NodeIdentity | null {
  try {
    const row = getConfigDb()
      .prepare("SELECT node_id, pubkey_pem, privkey_path, created_at FROM node_identity WHERE id = 1")
      .get() as NodeIdentity | undefined;
    return row ?? null;
  } catch {
    // V8 migration hasn't run yet (e.g. during the migration itself).
    return null;
  }
}

function writeKeyFiles(privPem: string, pubPem: string): void {
  ensureDataDir();
  // 0600 on the private key — even root-owned shouldn't matter on a single-user box,
  // but the principle stands: nothing else needs to read it.
  fs.writeFileSync(NODE_PRIVKEY_FILE, privPem, { mode: 0o600 });
  fs.writeFileSync(NODE_PUBKEY_FILE, pubPem, { mode: 0o644 });
}

function persistInDb(identity: NodeIdentity): void {
  getConfigDb()
    .prepare(
      "INSERT INTO node_identity (id, node_id, pubkey_pem, privkey_path, created_at) VALUES (1, ?, ?, ?, ?)"
    )
    .run(identity.node_id, identity.pubkey_pem, identity.privkey_path, identity.created_at);
}

/**
 * Generate a fresh Ed25519 keypair. Should only run on first boot or after an
 * explicit reset. Throws if an identity already exists in the DB to prevent
 * accidental key rotation (which would orphan every paired peer).
 */
function generateIdentity(): NodeIdentity {
  const existing = loadFromDb();
  if (existing) {
    throw new Error(
      "Node identity already exists. Use `resetIdentity({ confirm: true })` to rotate keys — but be aware this unpairs all peers."
    );
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const node_id = fingerprint(publicKey);

  writeKeyFiles(privPem, pubPem);
  const identity: NodeIdentity = {
    node_id,
    pubkey_pem: pubPem,
    privkey_path: NODE_PRIVKEY_FILE,
    created_at: Date.now(),
  };
  persistInDb(identity);
  return identity;
}

/**
 * Returns the cached identity + KeyObjects. The first call loads from disk,
 * verifies the on-disk key matches what the DB has recorded, and caches.
 * Subsequent calls are O(1).
 */
export function getIdentity(): { identity: NodeIdentity; privKey: KeyObject; pubKey: KeyObject } {
  if (cached) return cached;

  let identity = loadFromDb();
  if (!identity) {
    identity = generateIdentity();
  }

  if (!fs.existsSync(identity.privkey_path)) {
    throw new Error(
      `Node identity is recorded in the database but the private key file at ${identity.privkey_path} is missing. ` +
        `Restore it from a backup, or run \`resetIdentity({ confirm: true })\` to start fresh (which unpairs all peers).`
    );
  }

  const privPem = fs.readFileSync(identity.privkey_path, "utf8");
  const privKey = createPrivateKey({ key: privPem, format: "pem" });
  const pubKey = createPublicKey({ key: identity.pubkey_pem, format: "pem" });

  // Defence in depth: confirm the loaded key matches the recorded fingerprint.
  const fp = fingerprint(pubKey);
  if (fp !== identity.node_id) {
    throw new Error(
      `Node identity mismatch: recorded ${identity.node_id} but key on disk produces ${fp}. ` +
        `Restore the correct key or reset.`
    );
  }

  cached = { identity, privKey, pubKey };
  return cached;
}

/** Convenience accessor — just the public-facing identity record. */
export function getNodeIdentity(): NodeIdentity {
  return getIdentity().identity;
}

/** Returns the public key PEM for export (QR code at pairing time, etc.). */
export function exportPublicKey(): string {
  return getIdentity().identity.pubkey_pem;
}

/**
 * Parse a peer's public key from PEM. Used during pairing and when verifying
 * incoming signed envelopes.
 */
export function parsePeerPublicKey(pubkeyPem: string): KeyObject {
  return createPublicKey({ key: pubkeyPem, format: "pem" });
}

/** Compute the canonical node_id for a peer from its public key PEM. */
export function fingerprintOfPubkey(pubkeyPem: string): string {
  return fingerprint(parsePeerPublicKey(pubkeyPem));
}

/**
 * Rotate the node's keypair. Destructive — every paired peer must re-pair after
 * this. Requires explicit `confirm: true` to prevent fat-finger rotations.
 * Removes existing pairings since their trust records reference the old key.
 */
export function resetIdentity(opts: { confirm: true; reason?: string }): NodeIdentity {
  if (opts.confirm !== true) {
    throw new Error("resetIdentity requires { confirm: true }.");
  }
  const db = getConfigDb();
  db.transaction(() => {
    db.prepare("DELETE FROM fleet_peers").run();
    db.prepare("DELETE FROM node_identity WHERE id = 1").run();
  })();
  cached = null;
  if (fs.existsSync(NODE_PRIVKEY_FILE)) fs.unlinkSync(NODE_PRIVKEY_FILE);
  if (fs.existsSync(NODE_PUBKEY_FILE)) fs.unlinkSync(NODE_PUBKEY_FILE);
  return generateIdentity();
}
