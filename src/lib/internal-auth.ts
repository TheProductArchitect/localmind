import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { isLoopbackRequest } from "./auth/loopback";
import { DATA_DIR, ensureDataDir } from "./paths";

// Shared secret proving a request came from the local background worker.
//
// Previously this fell back to the literal string "localmind-internal" when
// LOCALMIND_INTERNAL_TOKEN was unset. The /api/internal/* routes are mapped as
// "public" (they carry their own token) and can trigger agent runs, scheduled
// tasks, and job execution — so a guessable default meant anyone able to reach
// the port (e.g. via an enabled tunnel or an SSRF in another tool) could drive
// the agent. We now require an explicit token, falling back to a per-install
// random secret persisted under DATA_DIR (mode 0600), never a constant.

const SECRET_FILE = path.join(DATA_DIR, "internal-token");

function loadToken(): string {
  if (process.env.LOCALMIND_INTERNAL_TOKEN) return process.env.LOCALMIND_INTERNAL_TOKEN;
  ensureDataDir();
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const t = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch {}
  const t = crypto.randomBytes(32).toString("hex");
  try {
    // Exclusive create so a concurrent first boot (worker + app) cannot end up
    // with two different tokens: whoever loses the race re-reads the winner's.
    fs.writeFileSync(SECRET_FILE, t, { mode: 0o600, flag: "wx" });
    return t;
  } catch {
    try {
      const existing = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (existing) return existing;
    } catch {}
  }
  return t;
}

let cached: string | null = null;

// The token the worker must present. Reads the env var first, otherwise the
// persisted per-install secret. Exposed so the in-process worker bootstrap can
// read the same value the API verifies against.
export function internalToken(): string {
  if (cached === null) cached = loadToken();
  return cached;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Verifies a request came from the local background worker on loopback with a
// valid per-install token. Token-only auth is insufficient when the port is
// exposed via a tunnel — loopback is required in addition.
export function isInternalRequest(req: NextRequest): boolean {
  if (!isLoopbackRequest((h) => req.headers.get(h))) return false;
  const presented = req.headers.get("x-localmind-internal");
  if (!presented) return false;
  return timingSafeEqualStr(presented, internalToken());
}
