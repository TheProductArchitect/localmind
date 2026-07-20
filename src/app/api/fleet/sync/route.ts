/**
 * POST /api/fleet/sync — pull conversation deltas from all sync-enabled peers
 * and merge them locally. Also used as a manual "Sync now" from the Fleet UI.
 */

import { NextResponse } from "next/server";
import { pullConversationsFromPeers } from "@/lib/fleet/conversation-sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await pullConversationsFromPeers();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
