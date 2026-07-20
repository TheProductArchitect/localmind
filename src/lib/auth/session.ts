import { NextRequest } from "next/server";
import { verifyJwt, signJwt, randomToken, hashToken } from "./jwt";
import {
  getUser, getSession, touchSession, getOwner, type User, createSession,
} from "../db/users";
import { getSettings } from "../db/queries";
import { isLoopbackRequest } from "./loopback";

export const ACCESS_TTL = 15 * 60; // seconds
export const REFRESH_TTL_MS: Record<string, number> = {
  owner: 30 * 24 * 3600 * 1000,
  member: 12 * 3600 * 1000,
  guest: 1 * 3600 * 1000,
};

export type Auth = { user: User; sessionId: string | null };

export function getAuth(req: NextRequest): Auth | null {
  const token = req.cookies.get("lm_token")?.value;
  if (token) {
    const payload = verifyJwt(token);
    if (payload) {
      const user = getUser(payload.userId);
      if (user && user.active) return { user, sessionId: req.cookies.get("lm_session")?.value || null };
    }
    // The caller presented a token but it didn't verify (expired, tampered,
    // signed under a different secret, or pointed at a deleted user). DO NOT
    // fall back to localhost-owner here — that would silently swap their
    // identity for the owner's and let any cross-user action succeed under
    // the wrong principal. Refuse the request.
    return null;
  }

  // No token: optionally fall back to owner on localhost so the no-login
  // single-user experience keeps working. This only kicks in when there is
  // genuinely no auth attempt on the request.
  const s = getSettings();
  if (!s.require_login && isLoopbackRequest((h) => req.headers.get(h))) {
    const owner = getOwner();
    if (owner) return { user: owner, sessionId: null };
  }
  return null;
}

export function requireAuth(req: NextRequest): Auth | null {
  return getAuth(req);
}

export function requireRole(req: NextRequest, role: "owner"): Auth | null {
  const auth = getAuth(req);
  if (!auth || auth.user.role !== role) return null;
  return auth;
}

export function issueSession(user: User, device: string, ip: string, authMethod: string) {
  const refresh = randomToken();
  const ttlMs = REFRESH_TTL_MS[user.role] ?? REFRESH_TTL_MS.member;
  const session = createSession({
    user_id: user.id,
    device,
    ip,
    auth_method: authMethod,
    ttlMs,
    refresh_token_hash: hashToken(refresh),
  });
  const access = signJwt({ userId: user.id, role: user.role }, ACCESS_TTL);
  return { access, refresh, session };
}

export function authCookies(access: string, refresh: string, sessionId: string) {
  const base = "Path=/; HttpOnly; SameSite=Strict";
  return [
    `lm_token=${access}; ${base}; Max-Age=${ACCESS_TTL}`,
    `lm_refresh=${refresh}; ${base}; Max-Age=${30 * 24 * 3600}`,
    `lm_session=${sessionId}; ${base}; Max-Age=${30 * 24 * 3600}`,
  ];
}

export function clearCookies() {
  const base = "Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  return [`lm_token=; ${base}`, `lm_refresh=; ${base}`, `lm_session=; ${base}`];
}

export { touchSession, getSession };
