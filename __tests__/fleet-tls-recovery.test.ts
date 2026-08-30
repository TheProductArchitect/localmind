import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A tls.crt that no longer matches node.key makes https.createServer throw, so
 * the fleet listener died at boot and pairing could only report "not running".
 * getTlsMaterial() must detect the mismatch and regenerate rather than hand
 * back material that cannot serve.
 */

let tmpDir: string;

describe("fleet TLS material recovery", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tls-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("regenerates when the certificate does not match node.key", async () => {
    const keysDir = path.join(tmpDir, "keys");
    fs.mkdirSync(keysDir, { recursive: true });

    const certFile = path.join(keysDir, "tls.crt");
    const keyFile = path.join(keysDir, "node.key");
    const fpFile = path.join(keysDir, "tls.sha256");

    // Ed25519 to match the node identity key type the fleet uses.
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    // A certificate that has nothing to do with that key.
    fs.writeFileSync(certFile, "-----BEGIN CERTIFICATE-----\nbogus\n-----END CERTIFICATE-----\n");
    fs.writeFileSync(fpFile, "stale-fingerprint");

    vi.doMock("../src/lib/paths", async (orig) => ({
      ...(await orig<typeof import("../src/lib/paths")>()),
      ensureDataDir: () => {},
      KEYS_DIR: keysDir,
      NODE_PRIVKEY_FILE: keyFile,
      TLS_CERT_FILE: certFile,
      TLS_FINGERPRINT_FILE: fpFile,
    }));
    vi.doMock("../src/lib/fleet/identity", () => ({
      getNodeIdentity: () => ({ node_id: "TESTNODE12345678" }),
    }));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getTlsMaterial } = await import("../src/lib/fleet/tls");

    const mat = getTlsMaterial();

    expect(mat.cert_pem).toMatch(/BEGIN CERTIFICATE/);
    expect(mat.fingerprint_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mat.fingerprint_sha256).not.toBe("stale-fingerprint");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("regenerating"),
      expect.any(String)
    );

    // The regenerated pair must actually be usable as a server identity —
    // that is the whole point, since the old pair made createServer throw.
    const https = await import("node:https");
    expect(() =>
      https.default.createServer({ cert: mat.cert_pem, key: mat.key_pem }).close()
    ).not.toThrow();

    warn.mockRestore();
  });

  it("keeps the existing certificate when it does match the key", async () => {
    const keysDir = path.join(tmpDir, "keys2");
    fs.mkdirSync(keysDir, { recursive: true });
    const certFile = path.join(keysDir, "tls.crt");
    const keyFile = path.join(keysDir, "node.key");
    const fpFile = path.join(keysDir, "tls.sha256");

    // Identity init normally writes this; cert generation requires it.
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }).toString());

    vi.doMock("../src/lib/paths", async (orig) => ({
      ...(await orig<typeof import("../src/lib/paths")>()),
      ensureDataDir: () => {},
      KEYS_DIR: keysDir,
      NODE_PRIVKEY_FILE: keyFile,
      TLS_CERT_FILE: certFile,
      TLS_FINGERPRINT_FILE: fpFile,
    }));
    vi.doMock("../src/lib/fleet/identity", () => ({
      getNodeIdentity: () => ({ node_id: "TESTNODE12345678" }),
    }));

    const { getTlsMaterial } = await import("../src/lib/fleet/tls");
    // First call generates and writes a consistent pair to disk.
    const first = getTlsMaterial();

    // Re-read from disk in a fresh module instance: no regeneration expected.
    vi.resetModules();
    const { getTlsMaterial: again } = await import("../src/lib/fleet/tls");
    const second = again();

    expect(second.fingerprint_sha256).toBe(first.fingerprint_sha256);
  });
});
