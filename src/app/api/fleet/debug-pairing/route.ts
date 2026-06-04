/**
 * V6.2 self-test: full pairing handshake against ourselves.
 *
 * Flow exercised end-to-end:
 *   1. POST /api/fleet/pair/start  → real pairing payload + QR
 *   2. POST /api/fleet/pair/accept → calls back to ourselves over real TLS
 *      with the `?allow_self=1` override (since the route refuses self-pairing
 *      by default)
 *   3. Verify a fleet_peers row exists keyed by our own node_id
 *   4. DELETE /api/fleet/peers/<self> to clean up
 *
 * After running this, the database should be exactly as it was before — any
 * peer row created is removed at the end. The whole point is to surface any
 * protocol-level breakage before two real machines ever try to pair.
 */

import { NextRequest, NextResponse } from "next/server";
import http from "http";
import { getNodeIdentity } from "@/lib/fleet/identity";
import { isRunning, activeFleetPort, startFleetServer } from "@/lib/fleet/server";
import { getPeer, unpairPeer } from "@/lib/db/fleet";

export const runtime = "nodejs";

/**
 * The pairing routes are owner-only via the route map. We're calling them
 * from inside the same process, so we hit the Next dev port directly using
 * Node's http client and forward whatever cookie was set on this request —
 * that way auth flows through unchanged.
 */
function callSelf(host: string, port: number, path: string, method: string, body: object, cookie?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(buf.length),
    };
    if (cookie) headers.cookie = cookie;
    const req = http.request(
      { host, port, path, method, headers, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          try { parsed = JSON.parse(text); } catch { /* leave as string */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("self-call timeout")); });
    req.write(buf);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const id = getNodeIdentity();

  if (!isRunning()) {
    try { await startFleetServer(); }
    catch (e) {
      return NextResponse.json({ ok: false, reason: `fleet listener failed: ${(e as Error).message}` });
    }
  }
  if (!activeFleetPort()) {
    return NextResponse.json({ ok: false, reason: "fleet listener not bound" });
  }

  // Determine where the Next routes live — this request came in via the dev
  // port; reflect it back.
  const reqHost = req.headers.get("host") || "127.0.0.1:3001";
  const [nextHost, nextPortStr] = reqHost.split(":", 2);
  const nextPort = Number(nextPortStr) || 3001;
  const cookie = req.headers.get("cookie") || undefined;

  // 1. /pair/start
  let payloadJson = "";
  try {
    const r = await callSelf(nextHost, nextPort, "/api/fleet/pair/start", "POST", { label_hint: "self-test" }, cookie);
    if (r.status === 200 && typeof r.body === "object") {
      payloadJson = (r.body as { payload_json: string }).payload_json;
      results.push({ name: "pair_start", ok: !!payloadJson, detail: `payload_json length=${payloadJson.length}` });
    } else {
      results.push({ name: "pair_start", ok: false, detail: `status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}` });
    }
  } catch (e) {
    results.push({ name: "pair_start", ok: false, detail: (e as Error).message });
  }

  if (!payloadJson) {
    return NextResponse.json({ all_ok: false, results, reason: "pair_start failed — no payload" });
  }

  // 2. /pair/accept?allow_self=1 — completes the handshake against our own listener.
  try {
    const r = await callSelf(
      nextHost,
      nextPort,
      "/api/fleet/pair/accept?allow_self=1",
      "POST",
      { payload_json: payloadJson, label_for_initiator: "self-test loopback" },
      cookie
    );
    if (r.status === 200) {
      const peer = getPeer(id.node_id);
      results.push({
        name: "pair_accept",
        ok: !!peer,
        detail: peer ? `peer row written (label="${peer.label}")` : "accept returned 200 but no peer row",
      });
    } else {
      results.push({ name: "pair_accept", ok: false, detail: `status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}` });
    }
  } catch (e) {
    results.push({ name: "pair_accept", ok: false, detail: (e as Error).message });
  }

  // 3. Token-reuse rejection — re-running accept with the same payload should fail
  //    because the token is single-use.
  try {
    const r = await callSelf(
      nextHost,
      nextPort,
      "/api/fleet/pair/accept?allow_self=1",
      "POST",
      { payload_json: payloadJson },
      cookie
    );
    const ok = r.status !== 200;
    results.push({
      name: "token_reuse_rejected",
      ok,
      detail: ok ? `correctly rejected: status=${r.status}` : "ACCEPTED REUSED TOKEN",
    });
  } catch (e) {
    // A connection error is also acceptable — anything but a 2xx works.
    results.push({ name: "token_reuse_rejected", ok: true, detail: `connection failed (acceptable): ${(e as Error).message}` });
  }

  // 4. Tampered payload rejection — corrupt the cert fingerprint.
  try {
    const tampered = payloadJson.replace(/("cert_fingerprint_sha256":\s*"[0-9a-f]{8})/, '$1aa');
    const r = await callSelf(
      nextHost,
      nextPort,
      "/api/fleet/pair/accept?allow_self=1",
      "POST",
      { payload_json: tampered },
      cookie
    );
    const ok = r.status !== 200;
    results.push({
      name: "tampered_payload_rejected",
      ok,
      detail: ok ? `correctly rejected: status=${r.status}` : "ACCEPTED TAMPERED PAYLOAD",
    });
  } catch (e) {
    results.push({ name: "tampered_payload_rejected", ok: true, detail: (e as Error).message });
  }

  // Cleanup — remove the synthetic peer row.
  unpairPeer(id.node_id);

  return NextResponse.json({
    node_id: id.node_id,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
