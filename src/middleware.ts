import { NextRequest, NextResponse } from "next/server";
import { requiredRoleFor, roleSatisfies } from "./lib/auth/route-map";
import { isLoopbackRequest } from "./lib/auth/loopback";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyJwtEdge(token: string): Promise<{ userId: string; role: string } | null> {
  const secret = process.env.LOCALMIND_JWT_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(parts[2]).slice().buffer,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`).slice().buffer
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

function deny(status: number, error: string, message: string) {
  return NextResponse.json({ status, error, message }, { status });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api")) return NextResponse.next();

  const required = requiredRoleFor(pathname, req.method);
  if (required === "public") return NextResponse.next();

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const token = bearer || req.cookies.get("lm_token")?.value || "";
  let identity = token ? await verifyJwtEdge(token) : null;

  // Localhost auto-login fallback. Applies ONLY when no token was presented
  // — a presented-but-invalid token (expired, tampered, signed under a
  // different secret) must NOT silently become the owner. That would let a
  // member's bad token authenticate as owner on localhost and quietly
  // promote every action they take — exactly the leak the isolation test
  // was catching.
  //
  // Locality is decided by isLoopbackRequest, NOT the raw Host header: a
  // forged `Host: localhost` or a request relayed through a reverse proxy /
  // Cloudflare tunnel must not be granted owner. Only a genuine direct
  // loopback request (no forwarding headers) qualifies.
  if (!identity && !token && isLoopbackRequest((h) => req.headers.get(h))) {
    identity = { userId: "__localhost_owner__", role: "owner" };
  }
  if (!identity) {
    return deny(401, "unauthorized", "Sign in to access this resource.");
  }
  if (!roleSatisfies(identity.role, required)) {
    return deny(403, "forbidden", `This action requires the ${required} role.`);
  }

  const headers = new Headers(req.headers);
  headers.set("x-user-id", identity.userId);
  headers.set("x-user-role", identity.role);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Node runtime is needed so process.env is read at request time. The edge
  // runtime inlines env vars at build, which made LOCALMIND_JWT_SECRET
  // effectively undefined in CI prod runs even when the variable was set at
  // job level. Requires experimental.nodeMiddleware in next.config.js.
  runtime: "nodejs",
  matcher: ["/api/:path*"],
};
