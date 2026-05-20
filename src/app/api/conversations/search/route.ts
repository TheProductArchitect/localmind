import { NextRequest, NextResponse } from "next/server";
import { searchMessages } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: searchMessages(q) });
}
