import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { listPasskeys } from "@/lib/db/passkeys";
import { rpInfo, setChallenge } from "@/lib/auth/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const creds = listPasskeys(userId);
  if (!creds.length) return NextResponse.json({ error: "No passkey registered for this account" }, { status: 404 });
  const { rpID } = rpInfo(req);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.credential_id })),
    userVerification: "preferred",
  });
  setChallenge(`auth:${userId}`, options.challenge);
  return NextResponse.json({ options });
}
