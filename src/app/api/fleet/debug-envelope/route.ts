/**
 * Internal debug endpoint for V6.0 foundation verification. Tests:
 *   - envelope sign + verify round-trip
 *   - tamper detection
 *   - wrong-recipient rejection
 *   - canonical JSON determinism
 *   - Lamport clock advance on verify
 *
 * Will be deleted before V6 ships — gated to internal-only requests so it
 * never surfaces to a paired peer or the public API. Even if it leaks past
 * the route map it's read-only and reveals only its own test results.
 */

import { NextResponse } from "next/server";
import { sign, verify, canonicalJson } from "@/lib/fleet/envelope";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { peek } from "@/lib/fleet/clock";

export const runtime = "nodejs";

export async function GET() {
  const me = getNodeIdentity();
  const pub = exportPublicKey();
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  const clockBefore = peek();
  const env = sign("capabilities", me.node_id, { models: ["llama3.2"], tools: ["filesystem"] });

  const v1 = verify(env, { senderPubkeyPem: pub, expectedRecipient: me.node_id });
  results.push({
    name: "round_trip",
    ok: v1.ok,
    detail: v1.ok ? `lamport=${env.lamport}` : v1.reason,
  });

  const tampered = { ...env, payload: { ...(env.payload as Record<string, unknown>), tools: ["evil"] } };
  const v2 = verify(tampered, { senderPubkeyPem: pub, expectedRecipient: me.node_id });
  results.push({
    name: "tamper_rejected",
    ok: !v2.ok,
    detail: v2.ok ? "ACCEPTED TAMPERED PAYLOAD" : v2.reason,
  });

  const v3 = verify(env, { senderPubkeyPem: pub, expectedRecipient: "wrong-node-id-zzzz" });
  results.push({
    name: "wrong_recipient_rejected",
    ok: !v3.ok,
    detail: v3.ok ? "ACCEPTED WRONG RECIPIENT" : v3.reason,
  });

  const a = canonicalJson({ b: 2, a: 1, nested: { y: 2, x: 1 } });
  const b = canonicalJson({ a: 1, nested: { x: 1, y: 2 }, b: 2 });
  results.push({
    name: "canonical_determinism",
    ok: a === b,
    detail: a === b ? "matched" : `a=${a} b=${b}`,
  });

  const clockAfter = peek();
  results.push({
    name: "lamport_advanced_on_verify",
    ok: clockAfter > clockBefore,
    detail: `${clockBefore} -> ${clockAfter}`,
  });

  return NextResponse.json({
    node_id: me.node_id,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
