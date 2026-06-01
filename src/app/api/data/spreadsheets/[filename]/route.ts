import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

function expand(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || ""));
}

async function resolveSafe(p: string, approved: string[]): Promise<string | null> {
  if (!p || approved.length === 0) return null;
  const abs = expand(p);
  if (!fsSync.existsSync(abs)) return null;
  let real: string;
  try { real = await fs.realpath(abs); } catch { return null; }
  for (const dir of approved) {
    const realDir = await fs.realpath(expand(dir)).catch(() => null);
    if (!realDir) continue;
    if (real === realDir || real.startsWith(realDir + path.sep)) return real;
  }
  return null;
}

// CSV decode mirrors src/lib/tools/spreadsheet.ts — kept inline so this route
// can render the file without importing the tool runtime.
function csvDecode(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else { field += c; }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export async function GET(req: NextRequest, { params }: { params: { filename: string } }) {
  // `filename` is actually a base64-url-encoded absolute path — the page sends
  // them this way to keep the URL safe even on macOS paths with spaces.
  let target: string;
  try {
    target = Buffer.from(decodeURIComponent(params.filename), "base64url").toString("utf8");
  } catch {
    return NextResponse.json({ error: "Invalid filename token." }, { status: 400 });
  }

  const s = getSettings();
  const approved = (() => {
    try { return JSON.parse(s.approved_dirs || "[]") as string[]; } catch { return []; }
  })();
  const safe = await resolveSafe(target, approved);
  if (!safe) {
    return NextResponse.json(
      { error: "Path is not inside an approved folder." },
      { status: 403 }
    );
  }

  if (req.nextUrl.searchParams.get("download") === "1") {
    const buf = await fs.readFile(safe);
    return new Response(buf, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${path.basename(safe)}"`,
      },
    });
  }

  const text = await fs.readFile(safe, "utf8");
  const grid = csvDecode(text);
  const headers = grid[0] || [];
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
  return NextResponse.json({ path: safe, headers, rows: rows.slice(0, 1000) });
}
