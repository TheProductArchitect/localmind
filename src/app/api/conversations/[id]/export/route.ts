import { NextRequest } from "next/server";
import { getConversation, getMessages } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const conv = getConversation(params.id);
  if (!conv) return new Response("Not found", { status: 404 });
  const messages = getMessages(params.id);

  let md = `# ${conv.title}\n\n_Exported ${new Date().toLocaleString()}_\n\n`;
  for (const m of messages) {
    if (m.role === "user") md += `## You\n\n${m.content}\n\n`;
    else if (m.role === "assistant") md += `## Assistant\n\n${m.content}\n\n`;
    else if (m.role === "tool") {
      try {
        const p = JSON.parse(m.content);
        md += `> **Tool:** ${p.name} — ${p.status}\n\n`;
      } catch {}
    }
  }

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown",
      "Content-Disposition": `attachment; filename="${conv.title.replace(/[^a-z0-9]/gi, "_")}.md"`,
    },
  });
}
