import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Localhost auto-login fallback contract.
 *
 * Before this fix, getAuth would fall back to "return the owner" whenever
 * a JWT failed to verify on a localhost request. That meant any caller who
 * presented a stale/wrong token silently became the owner — exactly the
 * footgun that caused the isolation test to see owner-with-4-conversations
 * after a member POSTed two with a token the server couldn't decode.
 *
 * The contract this test pins:
 *
 *   - No token + localhost + require_login=false → owner (legit no-login UX)
 *   - No token + localhost + require_login=true  → null (login required)
 *   - No token + non-localhost                   → null
 *   - Bad token (verify fails)                   → null, NEVER owner
 *   - Good token + active user                   → that user
 */

const ownerUser = { id: "owner-1", role: "owner", active: 1, display_name: "Owner" };
const memberUser = { id: "member-2", role: "member", active: 1, display_name: "Member" };

vi.mock("../src/lib/db/users", () => ({
  getUser: vi.fn((id: string) => (id === ownerUser.id ? ownerUser : id === memberUser.id ? memberUser : null)),
  getOwner: vi.fn(() => ownerUser),
}));
vi.mock("../src/lib/db/queries", () => ({
  getSettings: vi.fn(() => ({ require_login: 0 })),
}));
vi.mock("../src/lib/db/sessions", () => ({
  createSession: vi.fn(() => ({ id: "s1" })),
}));
vi.mock("../src/lib/auth/jwt", () => ({
  verifyJwt: vi.fn(() => null),
  signJwt: vi.fn(() => "signed.token.here"),
  randomToken: vi.fn(() => "rand"),
  hashToken: vi.fn(() => "hashed"),
}));

import { getAuth } from "../src/lib/auth/session";
import { verifyJwt } from "../src/lib/auth/jwt";
import { getSettings } from "../src/lib/db/queries";

const mockedVerify = vi.mocked(verifyJwt);
const mockedSettings = vi.mocked(getSettings);

function makeReq(opts: { token?: string; host?: string } = {}): any {
  const cookies = new Map<string, { value: string }>();
  if (opts.token) cookies.set("lm_token", { value: opts.token });
  return {
    cookies: { get: (k: string) => cookies.get(k) },
    headers: { get: (k: string) => (k === "host" ? (opts.host ?? "localhost:3000") : null) },
  };
}

describe("getAuth localhost fallback", () => {
  beforeEach(() => {
    mockedVerify.mockReturnValue(null);
    mockedSettings.mockReturnValue({ require_login: 0 } as any);
  });

  it("no token + localhost + require_login=false → returns owner", () => {
    const auth = getAuth(makeReq({ host: "localhost:3000" }));
    expect(auth?.user.id).toBe(ownerUser.id);
  });

  it("no token + localhost + require_login=true → null", () => {
    mockedSettings.mockReturnValue({ require_login: 1 } as any);
    expect(getAuth(makeReq({ host: "localhost:3000" }))).toBeNull();
  });

  it("no token + non-localhost → null", () => {
    expect(getAuth(makeReq({ host: "10.0.0.4:3000" }))).toBeNull();
  });

  it("BAD token + localhost → null (does NOT silently fall back to owner)", () => {
    mockedVerify.mockReturnValue(null);
    const auth = getAuth(makeReq({ token: "garbage.jwt.value", host: "localhost:3000" }));
    expect(auth, "presenting a token must NOT promote you to owner via the fallback").toBeNull();
  });

  it("GOOD token → returns the corresponding user", () => {
    mockedVerify.mockReturnValue({ userId: memberUser.id, role: memberUser.role, exp: Date.now() / 1000 + 3600 } as any);
    const auth = getAuth(makeReq({ token: "ok.jwt.value", host: "localhost:3000" }));
    expect(auth?.user.id).toBe(memberUser.id);
  });

  it("GOOD token pointing at inactive user → null", () => {
    mockedVerify.mockReturnValue({ userId: "deleted-user", role: "member", exp: Date.now() / 1000 + 3600 } as any);
    expect(getAuth(makeReq({ token: "ok", host: "localhost:3000" }))).toBeNull();
  });
});
