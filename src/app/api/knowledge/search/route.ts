import { NextRequest, NextResponse } from "next/server";
import { semanticSearch } from "@/lib/knowledge/search";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ results: [] });
  const results = await semanticSearch(q, Number(req.nextUrl.searchParams.get("k")) || 5);
  return NextResponse.json({ results });
}
