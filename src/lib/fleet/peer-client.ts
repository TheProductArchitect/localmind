/**
 * Outbound peer RPC. Every cross-node request goes through `sendToPeer` so
 * cert pinning, envelope signing, and timeout/retry policy live in one place.
 *
 * Pinning model: we trust a peer's TLS cert iff its SHA-256 fingerprint matches
 * the value recorded at pairing time. The fingerprint is stored on the
 * `fleet_peers` row (capabilities_json.tls_fingerprint_sha256 — V6.2 pairing
 * writes it). If a peer presents a different cert, the request fails closed —
 * we never accept "unknown" certs the way browsers do for first-visit pinning.
 *
 * Transport layer is HTTPS with cert validation via the `ca` trust list (a
 * one-element list containing the pinned peer cert). `checkServerIdentity` is
 * overridden to skip the hostname check because we're pinning the cert itself,
 * not its CN/SAN.
 *
 * Request body is always a SignedEnvelope. Response body is always a SignedEnvelope
 * (or an error JSON). The peer client doesn't interpret payloads — handlers do.
 */

import https from "https";
import { URL } from "url";
import { sign, verify, type EnvelopeKind, type SignedEnvelope } from "./envelope";
import { getNodeIdentity } from "./identity";
import { getPeer, type FleetPeer } from "../db/fleet";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_FLEET_PORT = Number(process.env.LOCALMIND_FLEET_PORT || 9443);

export type PeerSendResult<P = unknown> =
  | { ok: true; envelope: SignedEnvelope<P> }
  | { ok: false; status: number; reason: string };

export type SendOptions = {
  /** Override the timeout per-call. Default 8s. */
  timeoutMs?: number;
  /** Set to true for first-pairing flows where the peer's cert pin isn't yet stored. */
  unpinned?: boolean;
};

/** Extract the pinned peer cert from a fleet_peers row's capabilities_json. */
function pinnedCertOf(peer: FleetPeer): string | null {
  try {
    const caps = JSON.parse(peer.capabilities_json) as { tls_cert_pem?: string };
    return caps.tls_cert_pem ?? null;
  } catch {
    return null;
  }
}

function peerEndpoint(peer: FleetPeer, path: string): { host: string; port: number; pathname: string } {
  const addr = peer.primary_addr ?? "localhost";
  // primary_addr may be "host:port" or just "host". Default to fleet port.
  const [host, portStr] = addr.includes(":") ? addr.split(":", 2) : [addr, String(DEFAULT_FLEET_PORT)];
  const port = Number(portStr) || DEFAULT_FLEET_PORT;
  return { host, port, pathname: path };
}

/**
 * POST a signed envelope to a peer's `/fleet/{kind}` endpoint. On a 2xx,
 * parse and verify the response envelope using the same pinned cert + peer
 * pubkey. Failures are returned, not thrown.
 */
export async function sendToPeer<Req, Res>(
  peerNodeId: string,
  kind: EnvelopeKind,
  payload: Req,
  opts: SendOptions = {}
): Promise<PeerSendResult<Res>> {
  const peer = getPeer(peerNodeId);
  if (!peer) return { ok: false, status: 0, reason: `Unknown peer ${peerNodeId}` };

  const pinnedCert = opts.unpinned ? null : pinnedCertOf(peer);
  if (!pinnedCert && !opts.unpinned) {
    return { ok: false, status: 0, reason: `No pinned cert for peer ${peerNodeId} — pair first` };
  }

  const envelope = sign(kind, peerNodeId, payload);
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const { host, port } = peerEndpoint(peer, `/fleet/${kind}`);

  // `path` carries the kind so a single dispatcher on the receiver can route
  // without inspecting the envelope body before signature verification.
  const reqOpts: https.RequestOptions = {
    host,
    port,
    path: `/fleet/${kind}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-localmind-fleet-sender": getNodeIdentity().node_id,
    },
    ca: pinnedCert ? [pinnedCert] : undefined,
    rejectUnauthorized: !opts.unpinned,
    // We pinned the cert itself — hostname is irrelevant.
    checkServerIdentity: () => undefined,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  return new Promise<PeerSendResult<Res>>((resolve) => {
    const req = https.request(reqOpts, (res) => {
      let chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          resolve({ ok: false, status, reason: text.slice(0, 400) });
          return;
        }
        let respEnvelope: SignedEnvelope<Res>;
        try { respEnvelope = JSON.parse(text) as SignedEnvelope<Res>; }
        catch { resolve({ ok: false, status, reason: "Peer response was not JSON" }); return; }

        // Verify the response envelope using the peer's pubkey.
        const v = verify(respEnvelope, {
          senderPubkeyPem: peer.pubkey_pem,
          expectedRecipient: getNodeIdentity().node_id,
        });
        if (!v.ok) {
          resolve({ ok: false, status, reason: `Response envelope verify failed: ${v.reason}` });
          return;
        }
        resolve({ ok: true, envelope: v.envelope });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      const msg = err.message || String(err);
      resolve({ ok: false, status: 0, reason: msg });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Streaming peer RPC for chat-relay with stream_tokens. Expects NDJSON:
 *   {"type":"token","text":"…"}
 *   {"type":"result","envelope":{…signed…}}
 */
export async function sendToPeerNdjson<Req, Res>(
  peerNodeId: string,
  kind: EnvelopeKind,
  payload: Req,
  opts: SendOptions & {
    onToken?: (text: string) => void;
    /** Control frames other than tokens/result (e.g. remote confirmation gates). */
    onControl?: (frame: { type: string; [k: string]: unknown }) => void;
  } = {}
): Promise<PeerSendResult<Res>> {
  const peer = getPeer(peerNodeId);
  if (!peer) return { ok: false, status: 0, reason: `Unknown peer ${peerNodeId}` };

  const pinnedCert = opts.unpinned ? null : pinnedCertOf(peer);
  if (!pinnedCert && !opts.unpinned) {
    return { ok: false, status: 0, reason: `No pinned cert for peer ${peerNodeId} — pair first` };
  }

  const envelope = sign(kind, peerNodeId, payload);
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const { host, port } = peerEndpoint(peer, `/fleet/${kind}`);

  const reqOpts: https.RequestOptions = {
    host,
    port,
    path: `/fleet/${kind}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-localmind-fleet-sender": getNodeIdentity().node_id,
      accept: "application/x-ndjson",
    },
    ca: pinnedCert ? [pinnedCert] : undefined,
    rejectUnauthorized: !opts.unpinned,
    checkServerIdentity: () => undefined,
    timeout: opts.timeoutMs ?? 120_000,
  };

  return new Promise<PeerSendResult<Res>>((resolve) => {
    const req = https.request(reqOpts, (res) => {
      const status = res.statusCode ?? 0;
      const ct = String(res.headers["content-type"] || "");
      // Fallback: peer doesn't speak NDJSON — buffer as classic JSON envelope.
      if (!ct.includes("ndjson")) {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (status < 200 || status >= 300) {
            resolve({ ok: false, status, reason: text.slice(0, 400) });
            return;
          }
          try {
            const respEnvelope = JSON.parse(text) as SignedEnvelope<Res>;
            const v = verify(respEnvelope, {
              senderPubkeyPem: peer.pubkey_pem,
              expectedRecipient: getNodeIdentity().node_id,
            });
            if (!v.ok) {
              resolve({ ok: false, status, reason: `Response envelope verify failed: ${v.reason}` });
              return;
            }
            resolve({ ok: true, envelope: v.envelope });
          } catch {
            resolve({ ok: false, status, reason: "Peer response was not JSON" });
          }
        });
        return;
      }

      let buf = "";
      let settled = false;
      res.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as {
              type?: string;
              text?: string;
              envelope?: SignedEnvelope<Res>;
              [k: string]: unknown;
            };
            if (obj.type === "ping") {
              // Long confirm/tool waits emit no tokens — refresh the idle
              // socket timeout so the stream stays alive until the result.
              req.setTimeout(opts.timeoutMs ?? 120_000);
            } else if (obj.type === "token" && typeof obj.text === "string") {
              opts.onToken?.(obj.text);
              req.setTimeout(opts.timeoutMs ?? 120_000);
            } else if (obj.type === "result" && obj.envelope) {
              const v = verify(obj.envelope, {
                senderPubkeyPem: peer.pubkey_pem,
                expectedRecipient: getNodeIdentity().node_id,
              });
              settled = true;
              if (!v.ok) {
                resolve({ ok: false, status, reason: `Response envelope verify failed: ${v.reason}` });
              } else {
                resolve({ ok: true, envelope: v.envelope });
              }
            } else if (obj.type && obj.type !== "result" && obj.type !== "token") {
              opts.onControl?.(obj as { type: string; [k: string]: unknown });
              req.setTimeout(opts.timeoutMs ?? 120_000);
            }
          } catch {
            /* ignore partial/malformed line */
          }
        }
      });
      res.on("end", () => {
        if (!settled) {
          resolve({ ok: false, status, reason: "Stream ended without result envelope" });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, reason: err.message || String(err) });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Variant for the pairing flow: no peer record yet, so we accept any cert
 * matching the fingerprint that came in via QR scan. Used by V6.2 — surfaced
 * here so the pinning code stays in one file.
 *
 * Pinning is enforced via `checkServerIdentity`. That hook fires on every
 * fresh handshake with the negotiated peer cert (Node passes it as the second
 * argument) and can short-circuit the connection before any application
 * bytes flow. Crucially it works under TLS session resumption — the
 * post-handshake `getPeerCertificate()` route returns `{}` after a resumed
 * handshake, which silently broke pinning on the second connect to the same
 * host:port. We also bind a fresh agent per call to disable keep-alive +
 * session reuse outright (defence in depth).
 */
export async function sendUnpaired<Req, Res>(
  host: string,
  port: number,
  expectedCertFingerprint: string,
  expectedSenderPubkeyPem: string,
  expectedSenderNodeId: string,
  kind: EnvelopeKind,
  payload: Req,
  opts: SendOptions = {}
): Promise<PeerSendResult<Res>> {
  const expectedFp = expectedCertFingerprint.toLowerCase();
  const envelope = sign(kind, expectedSenderNodeId, payload);
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const freshAgent = new https.Agent({ keepAlive: false, maxSockets: 1 });

  return new Promise<PeerSendResult<Res>>((resolve) => {
    const req = https.request(
      {
        host,
        port,
        path: `/fleet/${kind}`,
        method: "POST",
        agent: freshAgent,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
          "x-localmind-fleet-sender": getNodeIdentity().node_id,
        },
        // checkServerIdentity does the actual pinning; we set rejectUnauthorized
        // false so Node doesn't trip over the self-signed cert before our hook
        // gets to run. The hook's return Error is what fails the handshake.
        rejectUnauthorized: false,
        checkServerIdentity: (_host, cert) => {
          const presented = (cert.fingerprint256 || "").replace(/:/g, "").toLowerCase();
          if (!presented) return new Error("Peer presented no certificate");
          if (presented !== expectedFp) {
            return new Error(`Cert fingerprint mismatch (expected ${expectedFp.slice(0, 16)}…, got ${presented.slice(0, 16)}…)`);
          }
          return undefined;
        },
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        // checkServerIdentity already enforced pinning before we got here;
        // anything reaching this callback has a cert that matched the pin.
        let chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            resolve({ ok: false, status, reason: text.slice(0, 400) });
            return;
          }
          let respEnvelope: SignedEnvelope<Res>;
          try { respEnvelope = JSON.parse(text) as SignedEnvelope<Res>; }
          catch { resolve({ ok: false, status, reason: "Peer response was not JSON" }); return; }

          const v = verify(respEnvelope, {
            senderPubkeyPem: expectedSenderPubkeyPem,
            expectedRecipient: getNodeIdentity().node_id,
            allowClockSkew: true,
          });
          if (!v.ok) {
            resolve({ ok: false, status, reason: `Response envelope verify failed: ${v.reason}` });
            return;
          }
          resolve({ ok: true, envelope: v.envelope });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, status: 0, reason: err.message || String(err) }));
    req.write(body);
    req.end();
  });
}
