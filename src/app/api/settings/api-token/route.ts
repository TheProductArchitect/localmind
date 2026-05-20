import { NextResponse } from "next/server";
import { randomToken, hashToken } from "@/lib/auth/jwt";
import { updateSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

// Generates a new API/webhook bearer token. The plaintext is shown once;
// only its hash is stored.
export async function POST() {
  const token = randomToken();
  updateSettings({ api_token_hash: hashToken(token) } as any);
  return NextResponse.json({ token });
}
