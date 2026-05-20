import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { readRecentLogLines, currentLogPath } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("download") === "1") {
    let content = "";
    try { content = fs.readFileSync(currentLogPath(), "utf8"); } catch {}
    return new Response(content, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": 'attachment; filename="localmind.log"',
      },
    });
  }
  return NextResponse.json({ lines: readRecentLogLines(500) });
}
