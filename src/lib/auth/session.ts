import { NextRequest } from "next/server";
import { verifyJwt, signJwt, randomToken, hashToken } from "./jwt";
import {
  getUser, getSession, touchSession, getOwner, type User, createSession,
} from "../db/users";
import { getSettings } from "../db/queries";

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
  }

  // Fallback: localhost without login requirement → owner auto-login
  const s = getSettings();
  const host = req.headers.get("host") || "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!s.require_login && isLocalhost) {
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
