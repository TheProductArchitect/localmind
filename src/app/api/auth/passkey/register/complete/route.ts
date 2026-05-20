import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getAuth } from "@/lib/auth/session";
import { savePasskey } from "@/lib/db/passkeys";
import { updateUser } from "@/lib/db/users";
import { rpInfo, takeChallenge } from "@/lib/auth/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { attestation } = await req.json();
  const challenge = takeChallenge(`reg:${auth.user.id}`);
  if (!challenge) return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
  const { rpID, origin } = rpInfo(req);

  try {
    const verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }
    const { credential } = verification.registrationInfo as any;
    savePasskey({
      credential_id: credential.id,
      user_id: auth.user.id,
      public_key: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
    });
    updateUser(auth.user.id, { auth_method: "both" });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Registration failed" }, { status: 400 });
  }
}
