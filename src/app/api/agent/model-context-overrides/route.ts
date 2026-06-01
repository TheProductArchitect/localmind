import { NextResponse } from "next/server";
import { listOverrides } from "@/lib/db/model-context-overrides";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ overrides: listOverrides() });
}
