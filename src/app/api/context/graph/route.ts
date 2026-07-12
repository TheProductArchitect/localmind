import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/identity";
import { getContextGraph } from "@/lib/context-graph";

export const runtime = "nodejs";

// The User Context Graph, scoped to the requesting user. Read-only; nothing
// here leaves the machine (§12.11). Phase 1 REST shape mirrors the notes graph.
export async function GET(req: NextRequest) {
  const user = currentUser(req);
  const graph = getContextGraph(user?.id ?? null, user?.display_name);
  return NextResponse.json(graph);
}
