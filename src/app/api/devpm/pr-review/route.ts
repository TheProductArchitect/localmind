import { NextRequest, NextResponse } from "next/server";
import { runAgentCollect } from "@/lib/agent/engine";
import { createConversation } from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 300;

// Generates a PR review from a diff. The review is never posted automatically —
// the caller decides whether to post it.
export async function POST(req: NextRequest) {
  const { diff, title } = await req.json();
  if (!diff) return NextResponse.json({ error: "diff required" }, { status: 400 });
  const convId = createConversation().id;
  const review = await runAgentCollect(
    convId,
    `Review this pull request${title ? ` ("${title}")` : ""}. Cover: what changed and why, potential issues (logic errors, missing tests, security, performance), suggested improvements, and questions for the author.\n\n\`\`\`diff\n${String(diff).slice(0, 20000)}\n\`\`\``,
    { systemPrefix: "You are DevPM performing a careful code review." }
  );
  return NextResponse.json({ review });
}
