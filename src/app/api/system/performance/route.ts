import { NextRequest, NextResponse } from "next/server";
import { getConfigDb, getConvDb, getKnowledgeDb } from "@/lib/db";
import { isOwner } from "@/lib/auth/identity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isOwner(req)) {
    return NextResponse.json({ status: 403, error: "forbidden", message: "Owner only." }, { status: 403 });
  }
  const days = Math.min(Number(req.nextUrl.searchParams.get("days")) || 7, 90);
  const since = Date.now() - days * 86400_000;
  const config = getConfigDb();
  const conv = getConvDb();
  const knowledge = getKnowledgeDb();

  // --- Tool performance (from the audit log) ---
  const toolRows = config
    .prepare(
      `SELECT tool_name,
              COUNT(*) AS calls,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures
       FROM audit_log WHERE timestamp >= ? GROUP BY tool_name ORDER BY calls DESC`
    )
    .all(since) as { tool_name: string; calls: number; failures: number }[];
  const tools = toolRows.map((t) => ({
    tool: t.tool_name,
    calls: t.calls,
    errorRate: t.calls ? Math.round((t.failures / t.calls) * 1000) / 10 : 0,
  }));

  // --- Daily action volume (proxy for chat activity) ---
  const dailyRows = config
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch')) AS day, COUNT(*) AS n
       FROM audit_log WHERE timestamp >= ? GROUP BY day ORDER BY day`
    )
    .all(since) as { day: string; n: number }[];

  // --- Model usage ---
  const convCount = (conv.prepare("SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?").get(since) as { n: number }).n;
  const msgRows = conv
    .prepare("SELECT role, COUNT(*) AS n, AVG(token_count) AS avg_tok FROM messages WHERE created_at >= ? GROUP BY role")
    .all(since) as { role: string; n: number; avg_tok: number }[];

  // --- Knowledge base stats ---
  const docCount = (knowledge.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n;
  const chunkCount = (knowledge.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  const recentDocs = knowledge
    .prepare("SELECT file_name, last_indexed_at, status FROM documents ORDER BY last_indexed_at DESC LIMIT 5")
    .all();

  // --- Worker health (jobs table) ---
  const jobs = config
    .prepare(
      `SELECT type, status, started_at, finished_at
       FROM jobs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 10`
    )
    .all() as { type: string; status: string; started_at: number; finished_at: number }[];
  const workerHealth = jobs.map((j) => ({
    type: j.type,
    status: j.status,
    durationMs: j.finished_at - j.started_at,
    finishedAt: j.finished_at,
  }));

  return NextResponse.json({
    days,
    dailyVolume: dailyRows,
    tools,
    models: {
      conversations: convCount,
      messages: msgRows,
    },
    knowledge: { documents: docCount, chunks: chunkCount, recent: recentDocs },
    workerHealth,
  });
}
