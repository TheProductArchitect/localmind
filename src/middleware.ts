import { NextRequest, NextResponse } from "next/server";
import { requiredRoleFor, roleSatisfies } from "./lib/auth/route-map";

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

  // Localhost without a JWT resolves to the owner (owner auto-login path).
  if (!identity) {
    const host = req.headers.get("host") || "";
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
      identity = { userId: "__localhost_owner__", role: "owner" };
    }
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
  matcher: ["/api/:path*"],
};
