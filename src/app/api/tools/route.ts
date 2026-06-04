/**
 * GET /api/tools — list every tool Sora can call, with a one-line description.
 *
 * The system-prompt editor uses this to render the per-persona tool toggle
 * grid. The response excludes implementation details (handlers, schemas)
 * and only carries what a human needs to decide whether to grant access.
 */

import { NextResponse } from "next/server";
import { listAllTools } from "@/lib/tools";

export const runtime = "nodejs";

export async function GET() {
  const tools = await listAllTools();
  return NextResponse.json({
    tools: tools.map((t) => ({
      name: t.definition.name,
      description: t.definition.description.split("\n")[0],
      action_type: t.actionType,
    })),
  });
}
