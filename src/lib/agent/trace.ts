import { getProcess } from "../db/agent-processes";
import { getConfigDb, getConvDb } from "../db";

export type TraceEvent = {
  timestamp: number;
  event_type: string;
  content: string;
  duration_ms?: number;
};

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function buildTrace(processId: string): TraceEvent[] {
  const proc = getProcess(processId);
  if (!proc) return [];

  const meta = safeJson<Record<string, unknown>>(proc.metadata_json);
  const events: TraceEvent[] = [
    {
      timestamp: proc.started_at,
      event_type: "process_started",
      content: `${proc.process_type} — ${proc.display_name}`,
    },
  ];

  const conversationId = (meta?.conversation_id as string | undefined) ?? null;
  if (conversationId) {
    const auditRows = getConfigDb()
      .prepare(
        "SELECT timestamp, action_type, tool_name, status, output_summary, input FROM audit_log WHERE conversation_id=? ORDER BY id ASC"
      )
      .all(conversationId) as Array<{
        timestamp: number;
        action_type: string;
        tool_name: string;
        status: string;
        output_summary: string | null;
        input: string;
      }>;
    for (const a of auditRows) {
      if (a.timestamp < proc.started_at - 1000) continue;
      events.push({
        timestamp: a.timestamp,
        event_type: `tool_${a.status}`,
        content: `${a.tool_name}: ${(a.output_summary || a.input || "").slice(0, 200)}`,
      });
    }

    try {
      const toolRows = getConvDb()
        .prepare(
          "SELECT tc.tool_name, tc.status, tc.duration_ms, m.created_at FROM tool_calls tc JOIN messages m ON tc.message_id = m.id WHERE m.conversation_id=? ORDER BY m.created_at ASC"
        )
        .all(conversationId) as Array<{
          tool_name: string;
          status: string;
          duration_ms: number | null;
          created_at: number;
        }>;
      for (const t of toolRows) {
        if (t.created_at < proc.started_at - 1000) continue;
        events.push({
          timestamp: t.created_at,
          event_type: "tool_completed",
          content: `${t.tool_name} (${t.status})`,
          duration_ms: t.duration_ms ?? undefined,
        });
      }
    } catch {
      // tool_calls table may be missing on older clones — non-fatal.
    }
  }

  if (proc.completed_at) {
    events.push({
      timestamp: proc.completed_at,
      event_type: `process_${proc.status}`,
      content: `Process ${proc.status} after ${formatDuration(proc.completed_at - proc.started_at)}`,
    });
  } else if (proc.current_step) {
    events.push({
      timestamp: Date.now(),
      event_type: "status",
      content: proc.current_step,
    });
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}
