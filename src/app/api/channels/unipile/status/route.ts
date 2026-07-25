import { NextResponse } from "next/server";
import { unipileStatus } from "@/lib/channels/unipile";

export const runtime = "nodejs";

/** Unipile channel status — enabled flag, whether DSN/key are set (no secrets). */
export async function GET() {
  return NextResponse.json(unipileStatus());
}
