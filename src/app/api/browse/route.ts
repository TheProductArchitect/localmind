/**
 * The Browse surface's backend. Routes a user-supplied URL through the SAME
 * pipeline agents use — the Secure Browser MCP behind the web-guard — so the
 * in-app browser inherits every protection for free: kill switch, site
 * grants, sensitive-context blindness, sanitizer, prompt-injection scan,
 * and the page-read audit trail. There is deliberately NO separate "raw"
 * path here; if the user wants unfiltered Chromium they use their real
 * browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMcpTools } from "@/lib/tools/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE_BROWSER_TOOL = "mcp_builtin-secure-browser_read_secure_webpage";

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });
  }

  const tools = await getMcpTools().catch(() => []);
  const tool = tools.find((t) => t.definition.name === SECURE_BROWSER_TOOL);
  if (!tool) {
    return NextResponse.json(
      { error: "Secure Browser is not available. Check MCP → Secure Browser is bootstrapped and enabled." },
      { status: 503 }
    );
  }

  const result = await tool.execute({ url: url.trim() }, { conversationId: "__browse__", approvedDirs: [] });
  const blocked = !result.ok || result.output.startsWith("[SECURITY ALERT]");
  return NextResponse.json({
    ok: result.ok && !blocked,
    blocked,
    markdown: result.output,
  });
}
