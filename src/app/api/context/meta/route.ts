import { NextResponse } from "next/server";
import { NODE_KINDS, EDGE_KINDS, SOURCES } from "@/lib/context-graph";

export const runtime = "nodejs";

// Self-describing Context Graph taxonomy — queryable so the graph view, tools,
// and agents can discover valid node/edge kinds rather than duplicating them.
export async function GET() {
  return NextResponse.json({ nodeKinds: NODE_KINDS, edgeKinds: EDGE_KINDS, sources: SOURCES });
}
