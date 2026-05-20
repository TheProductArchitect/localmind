import { NextRequest, NextResponse } from "next/server";
import { submitConfirmation, confirmationRequiresPin } from "@/lib/agent/confirmations";
import { getSettings } from "@/lib/db/queries";
import { logSecurityEvent } from "@/lib/db/jobs";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

// PIN brute-force lockout (in-memory, resets on restart).
let pinAttempts = { count: 0, until: 0 };

export async function POST(req: NextRequest) {
  const { toolCallId, decision, pin } = await req.json();
  if (!toolCallId || (decision !== "allow" && decision !== "deny")) {
    return NextResponse.json({ error: "toolCallId and decision required" }, { status: 400 });
  }

  const requiresPin = confirmationRequiresPin(toolCallId);
  if (requiresPin === null) {
    return NextResponse.json({ error: "No pending confirmation for that ID" }, { status: 404 });
  }

  if (decision === "allow") {
    const s = getSettings();

    // PIN-tier actions cannot proceed without a correct PIN.
    if (requiresPin) {
      if (!s.pin_hash) {
        return NextResponse.json(
          { error: "This action needs a PIN, but none is set. Set a PIN in Settings before allowing it." },
          { status: 403 }
        );
      }
      if (pinAttempts.until > Date.now()) {
        return NextResponse.json(
          { error: "Too many incorrect PIN attempts. Try again in a few minutes." },
          { status: 429 }
        );
      }
      if (typeof pin !== "string" || pin.length < 4) {
        return NextResponse.json({ error: "A PIN is required to allow this action." }, { status: 401 });
      }
      const ok = await bcrypt.compare(pin, s.pin_hash);
      if (!ok) {
        pinAttempts.count++;
        if (pinAttempts.count >= 3) pinAttempts.until = Date.now() + 5 * 60_000;
        logSecurityEvent("pin_failed", `Incorrect PIN on confirmation ${toolCallId}`);
        return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
      }
      pinAttempts = { count: 0, until: 0 };
    } else if (s.pin_hash && pin !== undefined) {
      // Optional PIN on an ask-tier action — verify only if one was supplied.
      if (!(await bcrypt.compare(String(pin), s.pin_hash))) {
        return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
      }
    }
  }

  submitConfirmation(toolCallId, decision);
  return NextResponse.json({ ok: true });
}
