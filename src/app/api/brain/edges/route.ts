import { NextRequest, NextResponse } from "next/server";
import { listEdges } from "@/lib/db/brain";

export const runtime = "nodejs";

// Query the Brain's entity graph directly. `?entity=<name|slug>` scopes to
// edges touching one entity. `edgeTypes` lists the distinct relationship types
// present so a client can discover the (free-form) vocabulary in use.
export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity") || undefined;
  const edges = listEdges(entity);
  const edgeTypes = [...new Set(edges.map((e) => e.edge_type))].sort();
  return NextResponse.json({ edges, edgeTypes });
}
