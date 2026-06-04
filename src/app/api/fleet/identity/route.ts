/**
 * GET /api/fleet/identity — returns this node's public identity record.
 *
 * Used by the pairing UI to render the QR payload, by peers (over mTLS) to
 * confirm the node they're talking to, and by debug tooling. The private key
 * never appears in any response; only the SHA-256 fingerprint (node_id) and
 * the public-key PEM.
 */

import { NextResponse } from "next/server";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { peek } from "@/lib/fleet/clock";

export const runtime = "nodejs";

export async function GET() {
  const id = getNodeIdentity();
  return NextResponse.json({
    node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    created_at: id.created_at,
    lamport: peek(),
  });
}
