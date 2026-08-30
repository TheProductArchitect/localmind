import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROUTE_MAP, requiredRoleFor, type RouteRole } from "../src/lib/auth/route-map";

/**
 * Contract audit over EVERY API route on disk.
 *
 * The middleware authorizes by table lookup, so a route whose path is missing
 * from `ROUTE_MAP` silently falls back to owner-only — it ships, it 403s for
 * normal users, and nothing fails until someone clicks the button. These tests
 * make that (and accidental public exposure) a test failure instead.
 */

const API_ROOT = path.resolve(__dirname, "../src/app/api");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type RouteFile = {
  /** URL path with dynamic segments filled in, e.g. `/api/conversations/abc`. */
  urlPath: string;
  file: string;
  methods: string[];
  isDynamic: boolean;
};

function listRouteFiles(dir = API_ROOT): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full);
  }
  return out.sort();
}

/** `src/app/api/conversations/[id]/route.ts` -> `/api/conversations/sample`. */
function toUrlPath(file: string): { urlPath: string; isDynamic: boolean } {
  const rel = path.relative(path.resolve(__dirname, "../src/app"), path.dirname(file));
  const segments = rel.split(path.sep).filter((s) => !s.startsWith("(") && s !== "");
  let isDynamic = false;
  const filled = segments.map((s) => {
    if (/^\[\.\.\..+\]$/.test(s)) {
      isDynamic = true;
      return "sample/deep";
    }
    if (/^\[.+\]$/.test(s)) {
      isDynamic = true;
      return "sample";
    }
    return s;
  });
  return { urlPath: `/${filled.join("/")}`, isDynamic };
}

function exportedMethods(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  return HTTP_METHODS.filter((m) => {
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`),
      new RegExp(`export\\s+const\\s+${m}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`),
    ];
    return patterns.some((p) => p.test(src));
  });
}

const routes: RouteFile[] = listRouteFiles().map((file) => {
  const { urlPath, isDynamic } = toUrlPath(file);
  return {
    urlPath,
    isDynamic,
    file: path.relative(path.resolve(__dirname, ".."), file),
    methods: exportedMethods(file),
  };
});

/** True when some ROUTE_MAP entry actually covers this path+method. */
function hasExplicitEntry(urlPath: string, method: string): boolean {
  const segs = urlPath.split("/");
  return ROUTE_MAP.some((entry) => {
    const pp = entry.path.split("/");
    const methodOk = entry.methods === "ALL" || entry.methods.includes(method);
    if (!methodOk) return false;
    if (pp[pp.length - 1] === "*") {
      if (segs.length < pp.length) return false;
      return pp.slice(0, -1).every((p, i) => p === "*" || p === segs[i]);
    }
    if (pp.length !== segs.length) return false;
    return pp.every((p, i) => p === "*" || p === segs[i]);
  });
}

describe("API route contract", () => {
  it("discovers the full route surface", () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it("exports at least one HTTP handler per route file", () => {
    const empty = routes.filter((r) => r.methods.length === 0);
    expect(empty.map((r) => r.file)).toEqual([]);
  });

  it("declares every route+method in ROUTE_MAP (no silent owner-only fallback)", () => {
    const missing: string[] = [];
    for (const r of routes) {
      for (const m of r.methods) {
        if (m === "OPTIONS" || m === "HEAD") continue;
        if (!hasExplicitEntry(r.urlPath, m)) missing.push(`${m} ${r.urlPath} (${r.file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves a concrete role for every route+method", () => {
    const roles: RouteRole[] = ["public", "authenticated", "member", "owner"];
    for (const r of routes) {
      for (const m of r.methods) {
        expect(roles).toContain(requiredRoleFor(r.urlPath, m));
      }
    }
  });

  it("keeps the set of publicly reachable routes to the reviewed list", () => {
    const publicRoutes = new Set<string>();
    for (const r of routes) {
      for (const m of r.methods) {
        if (requiredRoleFor(r.urlPath, m) === "public") {
          publicRoutes.add(r.urlPath.replace(/\/sample(\/deep)?/g, "/*"));
        }
      }
    }
    expect([...publicRoutes].sort()).toEqual(REVIEWED_PUBLIC_ROUTES);
  });

  it("makes every public route authenticate itself", () => {
    // A route the middleware waves through must prove the caller some other
    // way: loopback/internal token, webhook signature, or API bearer hash.
    const guards = [
      /isInternalRequest/,
      /isLoopback/,
      /hashToken/,
      /webhookSecret|x-telegram-bot-api-secret-token/,
      /validateRequest|X-Twilio-Signature|twilio/i,
      /verifyHmac|createHmac|timingSafeEqual/,
      /signature/i,
    ];
    const unguarded = routes
      .filter((r) => r.methods.some((m) => requiredRoleFor(r.urlPath, m) === "public"))
      // The auth handshake endpoints ARE the authentication, and health is a probe.
      .filter((r) => !r.urlPath.startsWith("/api/auth/") && r.urlPath !== "/api/health")
      .filter((r) => {
        const src = fs.readFileSync(path.resolve(__dirname, "..", r.file), "utf8");
        return !guards.some((g) => g.test(src));
      });
    expect(unguarded.map((r) => r.file)).toEqual([]);
  });

  it("never leaves a ROUTE_MAP entry pointing at a route that no longer exists", () => {
    const concrete = ROUTE_MAP.filter((e) => !e.path.includes("*"));
    const known = new Set(routes.map((r) => r.urlPath));
    const stale = concrete.filter((e) => !known.has(e.path)).map((e) => e.path);
    expect(stale).toEqual([]);
  });
});

/**
 * Public = anyone on the network can call it without a JWT. Every entry here is
 * deliberate: health probes, the login/passkey handshake, and webhook/relay
 * endpoints that authenticate themselves with an HMAC or bearer token.
 * Adding to this list should be a conscious review step, hence the exact match.
 */
const REVIEWED_PUBLIC_ROUTES: string[] = [
  "/api/auth/bootstrap",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/passkey/authenticate/begin",
  "/api/auth/passkey/authenticate/complete",
  "/api/auth/refresh",
  "/api/channels/telegram",
  "/api/channels/twilio/sms",
  "/api/channels/twilio/voice",
  "/api/channels/twilio/whatsapp",
  "/api/channels/unipile/webhook",
  "/api/channels/whatsapp",
  "/api/health",
  "/api/internal/idle-tick",
  "/api/internal/process-critic",
  "/api/internal/process-embeddings",
  "/api/internal/process-jobs",
  "/api/internal/run-monitor",
  "/api/internal/run-task",
  "/api/internal/run-task",
  "/api/v1",
  "/api/webhooks/*",
].filter((v, i, a) => a.indexOf(v) === i);
