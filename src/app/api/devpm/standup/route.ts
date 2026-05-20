import { NextRequest, NextResponse } from "next/server";
import { runAgentCollect } from "@/lib/agent/engine";
import { createConversation } from "@/lib/db/queries";
import { devpmSystemPrefix } from "@/lib/devpm";
import { listCodebases } from "@/lib/db/devpm";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { kind } = await req.json().catch(() => ({ kind: "standup" }));
  const convId = createConversation().id;

  // Use git history of each registered codebase as the "what was worked on" signal.
  let gitContext = "";
  const { execFileSync } = await import("child_process");
  for (const cb of listCodebases()) {
    try {
      const root = cb.path.replace(/^~/, process.env.HOME || "");
      const log = execFileSync("git", ["log", "--since=1.day", "--oneline"], { cwd: root, encoding: "utf8" });
      if (log.trim()) gitContext += `\nRecent commits in ${cb.name}:\n${log}`;
    } catch {}
  }

  const prompt =
    kind === "weekly"
      ? `Generate a weekly development summary. Recent git activity:${gitContext || " (none found)"}. Cover work completed, themes, and suggested priorities for next week.`
      : `Generate today's developer standup. Recent git activity:${gitContext || " (none found)"}. Cover: what was worked on yesterday, what's planned today, and anything blocked or needing attention. Keep it concise.`;

  const output = await runAgentCollect(convId, prompt, { systemPrefix: devpmSystemPrefix() });
  return NextResponse.json({ standup: output });
}
