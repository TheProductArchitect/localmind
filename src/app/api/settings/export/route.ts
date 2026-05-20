import { NextResponse } from "next/server";
import { Readable } from "stream";
import archiver from "archiver";
import {
  getSettings, listConversations, getMessages, listAudit, listMemory,
} from "@/lib/db/queries";
import { listMcpServers } from "@/lib/db/mcp";
import { listNotes } from "@/lib/db/knowledge";
import { logStart, logComplete } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

// Streams a ZIP archive of all user data.
export async function GET() {
  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", () => {});

  // Conversations — one JSON file each.
  for (const conv of listConversations()) {
    archive.append(JSON.stringify({ ...conv, messages: getMessages(conv.id) }, null, 2), {
      name: `conversations/${conv.id}.json`,
    });
  }

  // Audit log.
  archive.append(JSON.stringify(listAudit(100000, 0), null, 2), { name: "audit/audit-log.json" });

  // Memory.
  archive.append(JSON.stringify(listMemory(), null, 2), { name: "memory.json" });

  // Settings — encrypted fields redacted.
  const s: any = { ...getSettings() };
  for (const k of ["pin_hash", "api_token_hash"]) if (s[k]) s[k] = "redacted";
  archive.append(JSON.stringify(s, null, 2), { name: "settings.json" });

  // MCP servers — encrypted env omitted.
  archive.append(
    JSON.stringify(listMcpServers().map(({ env_encrypted, ...rest }) => rest), null, 2),
    { name: "mcp-servers.json" }
  );

  // Notes as individual Markdown files.
  for (const note of listNotes()) {
    const safe = note.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || note.id;
    archive.append(`# ${note.title}\n\n${note.content}`, { name: `knowledge/${safe}.md` });
  }

  archive.append(
    "LocalMind data export\n\n" +
      "This ZIP contains your conversations, audit log, memory, settings, MCP server\n" +
      "configurations, and knowledge-base notes. Encrypted secrets (PIN, API keys,\n" +
      "MCP credentials) are redacted and must be re-entered after a restore.\n\n" +
      "To restore: import this ZIP from Settings → Data & Privacy on a fresh install.\n",
    { name: "README.txt" }
  );

  const auditId = logStart({ actionType: "export_data", toolName: "export", input: {}, conversationId: null, approvedBy: "user" });
  logComplete(auditId, "allowed", "data exported as ZIP");

  archive.finalize();
  const webStream = Readable.toWeb(archive) as ReadableStream;
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=localmind-export-${date}.zip`,
    },
  });
}
