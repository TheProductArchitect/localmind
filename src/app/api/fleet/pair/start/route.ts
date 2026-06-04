/**
 * POST /api/fleet/pair/start
 *
 * Initiator flow step 1: opens a pairing window, returns the payload (raw JSON
 * + QR data URL) for display. The user shows the QR to the other device or
 * copies the JSON across.
 *
 * Body:
 *   {
 *     primary_addr?: string,   // override; defaults to host:port of this node's fleet listener
 *     ttl_ms?: number,         // override; default 5min
 *     label_hint?: string,     // friendly name the initiator suggests for the new peer
 *   }
 *
 * Response:
 *   {
 *     payload: PairingPayload,    // raw JSON encoded payload
 *     payload_json: string,       // stringified for direct copy-paste
 *     qr_svg: string,             // SVG markup of the QR code
 *     window: { token_short, expires_at, ... }   // for UI countdown
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { openPairingWindow, encodePayload } from "@/lib/fleet/pairing";
import { activeFleetPort, isRunning } from "@/lib/fleet/server";
import os from "os";

export const runtime = "nodejs";

const Body = z.object({
  primary_addr: z.string().min(1).max(255).optional(),
  ttl_ms: z.number().int().min(60_000).max(60 * 60 * 1000).optional(),
  label_hint: z.string().min(1).max(80).optional(),
});

function detectPrimaryAddr(): string {
  const port = activeFleetPort() ?? Number(process.env.LOCALMIND_FLEET_PORT || 9443);
  // Prefer a non-loopback v4 address so the QR works from another device on
  // the same LAN. The user can override via primary_addr if they have a known
  // tailnet IP or domain.
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const a of list) {
      if (a.family === "IPv4" && !a.internal) return `${a.address}:${port}`;
    }
  }
  return `127.0.0.1:${port}`;
}

export async function POST(req: NextRequest) {
  if (!isRunning()) {
    return NextResponse.json(
      { error: "Fleet listener is not running. Check that openssl is installed and restart the app." },
      { status: 503 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pairing-start payload." }, { status: 400 });
  }

  const primaryAddr = parsed.data.primary_addr ?? detectPrimaryAddr();
  const { payload, window } = openPairingWindow({
    primary_addr: primaryAddr,
    ttl_ms: parsed.data.ttl_ms,
    label_hint: parsed.data.label_hint,
  });

  const payloadJson = encodePayload(payload);
  let qrSvg = "";
  try {
    qrSvg = await QRCode.toString(payloadJson, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    });
  } catch {
    // SVG rendering failed — paste path still works. Surface but don't fail.
    qrSvg = "";
  }

  return NextResponse.json({
    payload,
    payload_json: payloadJson,
    qr_svg: qrSvg,
    window: {
      token_short: window.token.slice(0, 8),
      issued_at: window.issued_at,
      expires_at: window.expires_at,
      ttl_ms: window.expires_at - window.issued_at,
    },
  });
}
