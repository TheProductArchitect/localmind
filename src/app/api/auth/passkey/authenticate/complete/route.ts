import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getPasskey, updatePasskeyCounter } from "@/lib/db/passkeys";
import { getUser, updateUser } from "@/lib/db/users";
import { rpInfo, takeChallenge } from "@/lib/auth/webauthn";
import { issueSession, authCookies } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { userId, assertion } = await req.json();
  const challenge = takeChallenge(`auth:${userId}`);
  if (!challenge) return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
  const cred = getPasskey(assertion?.id);
  if (!cred || cred.user_id !== userId) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 401 });
  }
  const user = getUser(userId);
  if (!user || !user.active) return NextResponse.json({ error: "Account inactive" }, { status: 401 });
  const { rpID, origin } = rpInfo(req);

  try {
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, "base64url"),
        counter: cred.counter,
      },
    });
    if (!verification.verified) {
      return NextResponse.json({ error: "Verification failed" }, { status: 401 });
    }
    // Counter regression check — reject replayed assertions.
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter !== 0 && newCounter <= cred.counter) {
      return NextResponse.json({ error: "Replay detected — credential rejected" }, { status: 401 });
    }
    updatePasskeyCounter(cred.credential_id, newCounter);
    updateUser(user.id, { last_login_at: Date.now() });

    const device = req.headers.get("user-agent") || "unknown";
    const ip = req.headers.get("x-forwarded-for") || "local";
    const { access, refresh, session } = issueSession(user, device, ip, "passkey");
    const res = NextResponse.json({ ok: true });
    for (const c of authCookies(access, refresh, session.id)) res.headers.append("Set-Cookie", c);
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Authentication failed" }, { status: 401 });
  }
}
