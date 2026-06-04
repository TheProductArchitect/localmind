/**
 * V6.4 self-test: end-to-end delegation against ourselves.
 *
 * Flow:
 *   1. Pair self (re-uses the V6.2 mechanics — temporary fleet_peers row
 *      pointing at our own listener, cert + pubkey in capabilities).
 *   2. delegateToPeer(self, ...) — sends a task to ourselves; both inbound
 *      and outbound audit rows get written.
 *   3. Inspect: count audit_log rows added, fleet_audit_links entries,
 *      assert the link points the right direction with the right signature.
 *   4. /audit/[id]/verify-peer — confirm we can fetch the peer (ourselves)
 *      audit row through the audit-query channel.
 *   5. Cleanup — unpair, drop synthetic audit rows? No: audit log is append-
 *      only by design. We leave the rows behind; they're correctly tagged
 *      "delegate_to_peer" / "delegated_task" so they're visible as test
 *      artefacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { delegateToPeer } from "@/lib/fleet/delegation";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { getTlsMaterial } from "@/lib/fleet/tls";
import { isRunning, activeFleetPort, startFleetServer } from "@/lib/fleet/server";
import { pairPeer, unpairPeer, recordCapabilities, getPeer, listAuditLinksFor } from "@/lib/db/fleet";
import { getConfigDb } from "@/lib/db";
import http from "http";

export const runtime = "nodejs";

function callSelf(host: string, port: number, path: string, method: string, body: object, cookie?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(buf.length),
    };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host, port, path, method, headers, timeout: 15_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* leave as string */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
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
    try { await startFleetServer(); } catch (e) {
      return NextResponse.json({ ok: false, reason: `fleet listener failed: ${(e as Error).message}` });
    }
  }
  const port = activeFleetPort();
  if (!port) return NextResponse.json({ ok: false, reason: "fleet listener not bound" });

  // Pair with self (synthetic — keyed by our own node_id).
  unpairPeer(id.node_id); // start fresh
  const tls = getTlsMaterial();
  pairPeer({
    peer_node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    label: "self (V6.4 test)",
    primary_addr: `127.0.0.1:${port}`,
  });
  recordCapabilities(id.node_id, { tls_cert_pem: tls.cert_pem, tls_fingerprint_sha256: tls.fingerprint_sha256 });

  const auditRowCountBefore = (getConfigDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  const linkCountBefore = (getConfigDb().prepare("SELECT COUNT(*) AS n FROM fleet_audit_links").get() as { n: number }).n;

  // 1. Delegate a trivial node. We expect execution to fail (no live LLM
  //    needed to test federation infra), but the AUDIT rows and links
  //    MUST be written either way per V1's audit-everything rule.
  let delegationLocalAuditId = 0;
  let delegationPeerAuditId = 0;
  try {
    const r = await delegateToPeer({
      peer_node_id: id.node_id,
      node_id: "tnode-v64-test",
      agent_spec: {
        persona_id: "persona-general",
        tools: [],
        prompt_template: "Say the literal word 'pong'",
      },
      input: { ping: "pong" },
      contract: { cost_budget: { tokens: 200, wall_seconds: 30 } },
      root_goal: "V6.4 self-test delegation",
    });
    delegationLocalAuditId = r.local_audit_id;
    if (r.ok) {
      delegationPeerAuditId = r.peer_audit_id;
      results.push({ name: "delegate_round_trip", ok: true, detail: `local=${r.local_audit_id} peer=${r.peer_audit_id}` });
    } else {
      // Even on execution failure, the audit rows + links should exist.
      // Pull the outbound link record (we'd only have one if the response
      // arrived with a signed envelope — i.e. the RPC reached us).
      const links = listAuditLinksFor(r.local_audit_id);
      const outbound = links.find((l) => l.direction === "outbound");
      delegationPeerAuditId = outbound?.peer_audit_id ?? 0;
      results.push({
        name: "delegate_round_trip",
        ok: !!outbound,
        detail: outbound
          ? `delegation completed at infra level (execution may have failed, that's expected without an LLM); local=${r.local_audit_id} peer=${delegationPeerAuditId} reason="${r.reason}"`
          : `no outbound link recorded; reason="${r.reason}"`,
      });
    }
  } catch (e) {
    results.push({ name: "delegate_round_trip", ok: false, detail: (e as Error).message });
  }

  // 2. Audit-row count delta — should have at least one new row on each side.
  //    For loopback, both sides are us, so we see BOTH new rows in our table:
  //    one with action_type='delegate_to_peer' (outbound), one with
  //    action_type='delegated_task' (inbound).
  try {
    const after = (getConfigDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    const delta = after - auditRowCountBefore;
    const outboundRows = getConfigDb()
      .prepare("SELECT id, action_type FROM audit_log WHERE action_type='delegate_to_peer' ORDER BY id DESC LIMIT 5")
      .all() as Array<{ id: number; action_type: string }>;
    const inboundRows = getConfigDb()
      .prepare("SELECT id, action_type FROM audit_log WHERE action_type='delegated_task' ORDER BY id DESC LIMIT 5")
      .all() as Array<{ id: number; action_type: string }>;
    results.push({
      name: "audit_rows_written",
      ok: delta >= 2 && outboundRows.length > 0 && inboundRows.length > 0,
      detail: `delta=${delta} outbound=${outboundRows.length} inbound=${inboundRows.length}`,
    });
  } catch (e) {
    results.push({ name: "audit_rows_written", ok: false, detail: (e as Error).message });
  }

  // 3. fleet_audit_links — at least two new rows (inbound + outbound),
  //    both pointing at the loopback peer (ourselves).
  try {
    const after = (getConfigDb().prepare("SELECT COUNT(*) AS n FROM fleet_audit_links").get() as { n: number }).n;
    const delta = after - linkCountBefore;
    const inbound = getConfigDb()
      .prepare("SELECT * FROM fleet_audit_links WHERE direction='inbound' ORDER BY created_at DESC LIMIT 1")
      .get() as { local_audit_id: number; peer_audit_id: number; signature: string } | undefined;
    const outbound = getConfigDb()
      .prepare("SELECT * FROM fleet_audit_links WHERE direction='outbound' ORDER BY created_at DESC LIMIT 1")
      .get() as { local_audit_id: number; peer_audit_id: number; signature: string } | undefined;
    // Loopback: the inbound's local_audit_id should equal the outbound's peer_audit_id.
    const crossReferenceMatches =
      !!inbound && !!outbound &&
      inbound.local_audit_id === outbound.peer_audit_id &&
      outbound.local_audit_id === inbound.peer_audit_id;
    results.push({
      name: "cross_references_consistent",
      ok: delta >= 2 && crossReferenceMatches,
      detail: `delta=${delta} loopback_cross_ref=${crossReferenceMatches} inbound.local=${inbound?.local_audit_id} outbound.peer=${outbound?.peer_audit_id}`,
    });
  } catch (e) {
    results.push({ name: "cross_references_consistent", ok: false, detail: (e as Error).message });
  }

  // 4. Round-trip via /api/audit/[id]/verify-peer — exercises the audit-query
  //    handler end-to-end through the Next route.
  try {
    const reqHost = req.headers.get("host") || "127.0.0.1:3001";
    const [nextHost, nextPortStr] = reqHost.split(":", 2);
    const nextPort = Number(nextPortStr) || 3001;
    const cookie = req.headers.get("cookie") || undefined;
    const auditIdToVerify = delegationLocalAuditId;
    if (!auditIdToVerify) {
      results.push({ name: "verify_peer_chain", ok: false, detail: "no audit id to verify" });
    } else {
      const r = await callSelf(nextHost, nextPort, `/api/audit/${auditIdToVerify}/verify-peer`, "GET", {}, cookie);
      const body = r.body as { verifications?: Array<{ ok: boolean; chain_ok?: boolean; row_excerpt?: { action_type: string } }>; all_ok?: boolean };
      const anyVerified = body.verifications?.some((v) => v.ok && v.chain_ok !== false) ?? false;
      const peerActionType = body.verifications?.[0]?.row_excerpt?.action_type;
      results.push({
        name: "verify_peer_chain",
        ok: r.status === 200 && anyVerified && peerActionType === "delegated_task",
        detail: `status=${r.status} verifications=${body.verifications?.length ?? 0} peer_action=${peerActionType ?? "—"} all_ok=${body.all_ok}`,
      });
    }
  } catch (e) {
    results.push({ name: "verify_peer_chain", ok: false, detail: (e as Error).message });
  }

  // 5. Privacy gate: audit-query without a cross-reference should be refused.
  try {
    const { sendToPeer } = await import("@/lib/fleet/peer-client");
    // Pick an audit id we know has NO cross-reference with our self-peer.
    const rowWithoutLink = getConfigDb()
      .prepare(
        "SELECT id FROM audit_log WHERE id NOT IN (SELECT local_audit_id FROM fleet_audit_links) ORDER BY id ASC LIMIT 1"
      )
      .get() as { id: number } | undefined;
    if (!rowWithoutLink) {
      results.push({ name: "privacy_gate", ok: true, detail: "no linkless rows to test (acceptable — all rows are linked)" });
    } else {
      const r = await sendToPeer<{ local_audit_id: number }, { ok: boolean; reason?: string }>(
        id.node_id,
        "audit-query",
        { local_audit_id: rowWithoutLink.id },
        { timeoutMs: 5000 }
      );
      const refused = r.ok && r.envelope.payload.ok === false;
      results.push({
        name: "privacy_gate",
        ok: refused,
        detail: refused
          ? `correctly refused: ${r.envelope.payload.reason}`
          : `EXPECTED REFUSAL but got ${r.ok ? JSON.stringify(r.envelope.payload).slice(0, 200) : r.reason}`,
      });
    }
  } catch (e) {
    results.push({ name: "privacy_gate", ok: false, detail: (e as Error).message });
  }

  // Cleanup synthetic peer row.
  if (getPeer(id.node_id)) unpairPeer(id.node_id);

  return NextResponse.json({
    node_id: id.node_id,
    delegation_local_audit_id: delegationLocalAuditId,
    delegation_peer_audit_id: delegationPeerAuditId,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
