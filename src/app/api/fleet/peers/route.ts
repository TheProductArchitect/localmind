import { NextResponse } from "next/server";
import { listPeers, parsePeerPolicy } from "@/lib/db/fleet";
import { heartbeatStatus } from "@/lib/fleet/heartbeat";
import { fleetListenerStatus } from "@/lib/fleet/server";

export const runtime = "nodejs";

export async function GET() {
  // Don't expose the cert PEM in the listing — it's stored in capabilities_json
  // but is large and only needed at RPC time. Surface the short fingerprint
  // and the parsed capability summary.
  const peers = listPeers().map((p) => {
    let caps: Record<string, unknown> = {};
    try { caps = JSON.parse(p.capabilities_json) as Record<string, unknown>; } catch { /* ignore */ }
    const { tls_cert_pem: _drop, ...safeCaps } = caps as Record<string, unknown> & { tls_cert_pem?: string };
    return {
      peer_node_id: p.peer_node_id,
      label: p.label,
      primary_addr: p.primary_addr,
      paired_at: p.paired_at,
      last_seen_at: p.last_seen_at,
      trusted: p.trusted,
      policy: parsePeerPolicy(p),
      capabilities: safeCaps,
    };
  });
  // Pairing silently requires the local listener, so the page that offers
  // pairing needs to be able to say when it is down, and why.
  return NextResponse.json({
    peers,
    heartbeat: heartbeatStatus(),
    listener: fleetListenerStatus(),
  });
}
