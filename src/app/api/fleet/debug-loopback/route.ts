/**
 * V6.1 self-test: connect to our own fleet HTTPS listener as if we were a
 * paired peer. Exercises the full stack — TLS cert pinning, envelope signing,
 * dispatcher, handler, response envelope, response verification.
 *
 * Mechanism: temporarily insert a `fleet_peers` row pointing at ourselves with
 * our own pubkey + cert, send a `capabilities-pull` envelope through the same
 * code path real peers use, then remove the row before returning.
 *
 * This route is internal-only; the fleet endpoints it exercises live on the
 * sidecar port (default 9443), not the Next port. If openssl wasn't found at
 * boot, the fleet listener never started and this test reports `transport_unavailable`.
 */

import { NextResponse } from "next/server";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { getTlsMaterial, opensslAvailable } from "@/lib/fleet/tls";
import {
  isRunning,
  activeFleetPort,
  startFleetServer,
} from "@/lib/fleet/server";
import { sendToPeer } from "@/lib/fleet/peer-client";
import {
  pairPeer,
  unpairPeer,
  recordCapabilities,
  type FleetPeer,
} from "@/lib/db/fleet";

export const runtime = "nodejs";

const LOOPBACK_PEER_ID = "loopback-self-test";

export async function GET() {
  const id = getNodeIdentity();

  if (!opensslAvailable()) {
    return NextResponse.json({
      ok: false,
      transport_unavailable: true,
      reason: "openssl not on PATH — fleet listener cannot start.",
    });
  }

  // Make sure the listener is up. Idempotent.
  if (!isRunning()) {
    try { await startFleetServer(); } catch (e) {
      return NextResponse.json({ ok: false, reason: `fleet listener failed: ${(e as Error).message}` });
    }
  }
  const port = activeFleetPort();
  if (!port) return NextResponse.json({ ok: false, reason: "fleet listener not bound" });

  const tls = getTlsMaterial();
  const pub = exportPublicKey();

  // Snapshot any existing loopback row so a partial state from a prior failed
  // test doesn't leak; we'll remove it either way at the end.
  unpairPeer(LOOPBACK_PEER_ID);

  // Insert a synthetic peer row pointing at ourselves over loopback.
  // Note: peer_node_id is just a key — the envelope signature is what gets
  // verified, and the envelope's `sender` field carries our REAL node_id.
  // The server's dispatch path looks up the peer by envelope.sender, so we
  // also need a row keyed by our own node_id. Easiest: pair ourselves under
  // both keys, then clean up both.
  const peer: FleetPeer = pairPeer({
    peer_node_id: id.node_id,
    pubkey_pem: pub,
    label: "self (loopback test)",
    primary_addr: `127.0.0.1:${port}`,
  });
  // Stash the cert PEM in capabilities_json so peer-client can find it for pinning.
  recordCapabilities(id.node_id, { tls_cert_pem: tls.cert_pem });

  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1) Health probe via plain HTTPS — no envelope, no auth. Just confirms the
  //    listener is reachable on the port we expect.
  try {
    const https = await import("https");
    const live = await new Promise<boolean>((resolve) => {
      const req = https.request(
        {
          host: "127.0.0.1",
          port,
          path: "/fleet/health",
          method: "GET",
          ca: [tls.cert_pem],
          rejectUnauthorized: true,
          checkServerIdentity: () => undefined,
          timeout: 3000,
        },
        (res) => {
          let chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve(res.statusCode === 200 && text.includes(id.node_id));
          });
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
    results.push({ name: "https_health_probe", ok: live, detail: live ? "GET /fleet/health → 200 with node_id" : "no response or wrong body" });
  } catch (e) {
    results.push({ name: "https_health_probe", ok: false, detail: (e as Error).message });
  }

  // 2) Full envelope round-trip via sendToPeer — TLS pinning, envelope sign,
  //    handler dispatch, response envelope, response verify.
  try {
    const r = await sendToPeer<Record<string, never>, Record<string, unknown>>(
      id.node_id,
      "capabilities-pull",
      {} as Record<string, never>,
      { timeoutMs: 5000 }
    );
    if (r.ok) {
      const payload = r.envelope.payload;
      const echoedNode = (payload as { node_id?: string }).node_id;
      results.push({
        name: "envelope_round_trip",
        ok: echoedNode === id.node_id,
        detail: echoedNode === id.node_id
          ? `capabilities-pull returned our own node_id, tools=${((payload as { tools?: string[] }).tools || []).length}`
          : `unexpected node_id in response: ${echoedNode}`,
      });
    } else {
      results.push({ name: "envelope_round_trip", ok: false, detail: r.reason });
    }
  } catch (e) {
    results.push({ name: "envelope_round_trip", ok: false, detail: (e as Error).message });
  }

  // 3) Wrong-cert-pin test — claim the peer's pin is something else, expect failure.
  try {
    // Tamper the stored cert to simulate a MitM with a different cert.
    recordCapabilities(id.node_id, { tls_cert_pem: tls.cert_pem.replace(/MII/g, "MZZ") });
    const r = await sendToPeer<Record<string, never>, Record<string, unknown>>(
      id.node_id,
      "capabilities-pull",
      {} as Record<string, never>,
      { timeoutMs: 3000 }
    );
    results.push({
      name: "wrong_cert_rejected",
      ok: !r.ok,
      detail: r.ok ? "ACCEPTED MISMATCHED PEER CERT" : r.reason,
    });
  } catch (e) {
    results.push({ name: "wrong_cert_rejected", ok: false, detail: (e as Error).message });
  } finally {
    // Restore the real cert in case the row stays around for some reason.
    recordCapabilities(id.node_id, { tls_cert_pem: tls.cert_pem });
  }

  // Clean up the synthetic peer row so subsequent operations don't see it.
  unpairPeer(id.node_id);

  return NextResponse.json({
    node_id: id.node_id,
    fleet_port: port,
    cert_fingerprint_short: tls.fingerprint_short,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
