import { NextRequest } from "next/server";
import { listAudit } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format") || "json";
  const rows = listAudit(10000, 0);
  if (format === "csv") {
    const header = "id,timestamp,action_type,tool_name,status,approved_by,conversation_id\n";
    const body = rows
      .map((r) =>
        [r.id, r.timestamp, r.action_type, r.tool_name, r.status, r.approved_by, r.conversation_id || ""]
          .map((x) => `"${String(x).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    return new Response(header + body, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="audit-log.csv"',
      },
    });
  }
  return new Response(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="audit-log.json"',
    },
  });
}
