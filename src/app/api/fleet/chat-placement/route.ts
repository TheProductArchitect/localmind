/**
 * GET /api/fleet/chat-placement — where should the next chat turn run?
 * Returns { kind: "local" } or { kind: "peer", peer_node_id, label }.
 */

import { NextResponse } from "next/server";
import { pickChatExecutor } from "@/lib/fleet/chat-placement";

export const runtime = "nodejs";

export async function GET() {
  try {
    const decision = await pickChatExecutor();
    return NextResponse.json(decision);
  } catch (e) {
    return NextResponse.json({ kind: "local", reason: (e as Error).message });
  }
}
