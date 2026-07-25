/**
 * GET /api/fleet/chat-placement — where should the next chat turn run?
 * Honors ?compute= pin or conversation compute_placement / settings default.
 * Returns { kind: "local" } or { kind: "peer", peer_node_id, label } plus workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolvePlacement } from "@/lib/fleet/placement-pins";
import { getConversation } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const computeQ = req.nextUrl.searchParams.get("compute");
    const workspaceQ = req.nextUrl.searchParams.get("workspace");
    const convId = req.nextUrl.searchParams.get("conversation_id");
    let computePin = computeQ;
    let workspacePin = workspaceQ;
    if (convId) {
      const conv = getConversation(convId);
      if (conv) {
        if (!computePin && conv.compute_placement) computePin = conv.compute_placement;
        if (!workspacePin && conv.workspace_placement) workspacePin = conv.workspace_placement;
      }
    }
    const placement = await resolvePlacement({
      computePin,
      workspacePin,
    });
    return NextResponse.json({
      ...placement.compute,
      workspace: placement.workspace,
    });
  } catch (e) {
    return NextResponse.json({ kind: "local", reason: (e as Error).message, workspace: { kind: "local" } });
  }
}
