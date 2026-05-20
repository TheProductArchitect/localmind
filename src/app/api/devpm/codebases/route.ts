import { NextRequest, NextResponse } from "next/server";
import { listCodebases, createCodebase } from "@/lib/db/devpm";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    codebases: listCodebases().map((c) => ({ ...c, commands: JSON.parse(c.commands || "[]") })),
  });
}

export async function POST(req: NextRequest) {
  const { name, path } = await req.json();
  if (!name || !path) return NextResponse.json({ error: "name and path required" }, { status: 400 });
  return NextResponse.json({ codebase: createCodebase(name, path) });
}
