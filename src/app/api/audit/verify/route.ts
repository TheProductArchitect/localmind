import { NextResponse } from "next/server";
import { verifyChain } from "@/lib/agent/audit-logger";

export const runtime = "nodejs";

export async function POST() {
  const result = verifyChain();
  return NextResponse.json(result);
}
