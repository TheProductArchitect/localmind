import { NextRequest } from "next/server";

// In-memory per-user challenge store (short-lived, single-process).
const challenges = new Map<string, { challenge: string; expires: number }>();

export function setChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}

export function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

export function rpInfo(req: NextRequest): { rpID: string; origin: string } {
  const host = req.headers.get("host") || "localhost:3000";
  const rpID = host.split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return { rpID, origin: `${proto}://${host}` };
}
