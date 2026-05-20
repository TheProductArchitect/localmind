import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getAuth } from "@/lib/auth/session";
import { listPasskeys } from "@/lib/db/passkeys";
import { rpInfo, setChallenge } from "@/lib/auth/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { rpID } = rpInfo(req);

  const options = await generateRegistrationOptions({
    rpName: "LocalMind",
    rpID,
    userName: auth.user.display_name,
    userID: Buffer.from(auth.user.id),
    attestationType: "none",
    excludeCredentials: listPasskeys(auth.user.id).map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  setChallenge(`reg:${auth.user.id}`, options.challenge);
  return NextResponse.json({ options });
}
