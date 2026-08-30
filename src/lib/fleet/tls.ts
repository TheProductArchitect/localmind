/**
 * TLS layer for peer-to-peer transport.
 *
 * Generates a self-signed X.509 certificate at first boot that wraps the SAME
 * Ed25519 public key the node identity uses. One key, two artefacts:
 *   - PKCS#8 PEM at  `~/.localmind/keys/node.key` (signing envelopes — V6.0)
 *   - X.509 PEM at   `~/.localmind/keys/tls.crt`  (TLS pipe — V6.1)
 *
 * The cert SHA-256 is the pinning value paired peers use to reject MitMs.
 * It's persisted alongside the cert for fast lookup and is what gets exchanged
 * in the pairing QR code (V6.2).
 *
 * Why openssl-shell-out: Node's stdlib can parse X.509 (`crypto.X509Certificate`)
 * but can't *create* one. Two real options:
 *   - bundle `node-forge` (~1MB) for a pure-JS generator
 *   - shell out to `openssl` which is present on every target platform
 *     (macOS arm64/x86, Ubuntu 22.04+, Debian 12+, WSL2 — verified in V6 Group 1)
 *
 * Shell-out wins because it's a one-time operation, the result is cached
 * forever, and we don't carry the dep weight for the other 99.9% of the app.
 * If openssl is unavailable, the fleet listener doesn't start and the rest of
 * LocalMind keeps running — federation degrades gracefully.
 */

import { spawnSync } from "child_process";
import crypto, { X509Certificate } from "crypto";
import fs from "fs";
import { ensureDataDir, KEYS_DIR, NODE_PRIVKEY_FILE, TLS_CERT_FILE, TLS_FINGERPRINT_FILE } from "../paths";
import { getNodeIdentity } from "./identity";

export type TlsMaterial = {
  cert_pem: string;
  key_pem: string;
  fingerprint_sha256: string;   // hex, lowercase, no colons — the canonical pin
  fingerprint_short: string;    // 16 hex chars, for UI display
  not_after: Date;
};

let cached: TlsMaterial | null = null;

/** Returns true if `openssl` is available on PATH. */
export function opensslAvailable(): boolean {
  const r = spawnSync("openssl", ["version"], { encoding: "utf8", timeout: 2000 });
  return r.status === 0;
}

function computeFingerprint(certPem: string): string {
  const cert = new X509Certificate(certPem);
  return crypto.createHash("sha256").update(cert.raw).digest("hex");
}

function persistFingerprint(fp: string): void {
  fs.writeFileSync(TLS_FINGERPRINT_FILE, fp + "\n", { mode: 0o644 });
}

/**
 * Generate a self-signed cert wrapping the existing Ed25519 key. 100-year
 * validity — we're not in the public PKI, so cert lifetime is irrelevant;
 * the actual security comes from pinning the SHA-256.
 */
function generateCert(): TlsMaterial {
  if (!opensslAvailable()) {
    throw new Error(
      "openssl is not available on PATH — fleet TLS cannot be initialised. " +
        "Install openssl (macOS: brew install openssl; Ubuntu/Debian: apt-get install openssl) and restart."
    );
  }
  if (!fs.existsSync(NODE_PRIVKEY_FILE)) {
    throw new Error(`Ed25519 private key missing at ${NODE_PRIVKEY_FILE} — run V6.0 identity init first.`);
  }

  const id = getNodeIdentity();

  // CN includes the fingerprint for human-readable cert identification.
  // SAN covers loopback so a node can talk to itself for self-tests.
  const subject = `/CN=localmind-${id.node_id}`;
  const sanExt = `subjectAltName=DNS:localhost,DNS:localmind.local,IP:127.0.0.1,IP:::1`;

  const r = spawnSync(
    "openssl",
    [
      "req", "-x509",
      "-key", NODE_PRIVKEY_FILE,
      "-out", TLS_CERT_FILE,
      "-days", "36500",
      "-subj", subject,
      "-addext", sanExt,
    ],
    { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (r.status !== 0) {
    throw new Error(`openssl cert generation failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  }
  fs.chmodSync(TLS_CERT_FILE, 0o644);

  const certPem = fs.readFileSync(TLS_CERT_FILE, "utf8");
  const fingerprint = computeFingerprint(certPem);
  persistFingerprint(fingerprint);

  const cert = new X509Certificate(certPem);
  return {
    cert_pem: certPem,
    key_pem: fs.readFileSync(NODE_PRIVKEY_FILE, "utf8"),
    fingerprint_sha256: fingerprint,
    fingerprint_short: fingerprint.slice(0, 16),
    not_after: new Date(cert.validTo),
  };
}

/**
 * Returns this node's TLS material, generating it on first call. Subsequent
 * calls return the cached value. The cert file is also persisted to disk so
 * across restarts the pin stays constant.
 */
export function getTlsMaterial(): TlsMaterial {
  if (cached) return cached;
  ensureDataDir();

  if (fs.existsSync(TLS_CERT_FILE)) {
    const certPem = fs.readFileSync(TLS_CERT_FILE, "utf8");
    const keyPem = fs.readFileSync(NODE_PRIVKEY_FILE, "utf8");

    // A cert that doesn't match node.key makes https.createServer throw, which
    // killed the fleet listener at boot with the reason buried in a log file.
    // Detect it here and regenerate. checkPrivateKey is the purpose-built API —
    // it avoids allocating a throwaway server just to validate the pair.
    try {
      const cert = new X509Certificate(certPem);
      if (!cert.checkPrivateKey(crypto.createPrivateKey(keyPem))) {
        throw new Error("certificate public key does not match node.key");
      }

      const fingerprint = computeFingerprint(certPem);

      if (fs.existsSync(TLS_FINGERPRINT_FILE)) {
        const recorded = fs.readFileSync(TLS_FINGERPRINT_FILE, "utf8").trim();
        if (recorded !== fingerprint) {
          console.warn(`[fleet.tls] fingerprint file mismatch (recorded=${recorded}, actual=${fingerprint}) — overwriting`);
        }
      }
      persistFingerprint(fingerprint);

      cached = {
        cert_pem: certPem,
        key_pem: keyPem,
        fingerprint_sha256: fingerprint,
        fingerprint_short: fingerprint.slice(0, 16),
        not_after: new Date(cert.validTo),
      };
      return cached;
    } catch (e) {
      console.warn(
        "[fleet.tls] existing certificate is unusable, regenerating:",
        (e as Error).message
      );
      // The pin changes, so already-paired peers must re-pair. That is
      // unavoidable once the key no longer matches, and strictly better than a
      // listener that refuses to start.
      if (fs.existsSync(TLS_CERT_FILE)) fs.unlinkSync(TLS_CERT_FILE);
      if (fs.existsSync(TLS_FINGERPRINT_FILE)) fs.unlinkSync(TLS_FINGERPRINT_FILE);
    }
  }

  cached = generateCert();
  return cached;
}

/** For UI / QR payload — short form, colon-grouped for human readability. */
export function formatFingerprint(fp: string): string {
  return fp.toLowerCase().match(/.{2}/g)?.join(":") ?? fp;
}

/**
 * Reset and regenerate the TLS cert. Called by `resetIdentity` (V6.0) and
 * standalone when a user explicitly rotates. Existing peers must re-pin
 * after this.
 */
export function resetTlsMaterial(opts: { confirm: true }): TlsMaterial {
  if (opts.confirm !== true) throw new Error("resetTlsMaterial requires { confirm: true }.");
  if (fs.existsSync(TLS_CERT_FILE)) fs.unlinkSync(TLS_CERT_FILE);
  if (fs.existsSync(TLS_FINGERPRINT_FILE)) fs.unlinkSync(TLS_FINGERPRINT_FILE);
  cached = null;
  // touch the keys dir to keep mode 0700 from earlier setup
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  return getTlsMaterial();
}
