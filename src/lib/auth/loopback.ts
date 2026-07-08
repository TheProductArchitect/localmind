// Decides whether a request genuinely originates from the local loopback
// interface — the only case in which the no-login "owner on localhost"
// convenience is safe to grant.
//
// The Host header on its own is NOT sufficient evidence of locality:
//   - It is fully attacker-controlled, so a remote client can send
//     `Host: localhost` directly.
//   - Reverse proxies and the Cloudflare quick-tunnel
//     (`cloudflared tunnel --url http://localhost:3000`) rewrite the upstream
//     Host to `localhost`, so every public visitor would arrive looking local.
//
// IMPORTANT: Next.js itself injects `x-forwarded-for`, `x-forwarded-host`, and
// `x-forwarded-proto` on EVERY request the middleware sees — including genuine
// direct loopback requests (e.g. XFF `::ffff:127.0.0.1`, XFH `127.0.0.1:3000`).
// So we cannot reject merely because a forwarding header is present; that would
// reject all local traffic. Instead we validate the VALUES: a genuine local
// request has loopback forwarded-host and loopback forwarded-for, while a
// reverse proxy / tunnel sets these to the public hostname / external client IP.

// Cloudflare + RFC 7239 headers that only appear when a request was relayed
// from off the box. Their mere presence is disqualifying.
const HARD_PROXY_HEADERS = [
  "forwarded",
  "cf-connecting-ip",
  "cf-ray",
  "true-client-ip",
] as const;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackHost(hostRaw: string | null | undefined): boolean {
  const host = (hostRaw || "").toLowerCase().trim();
  if (!host) return false;
  // Strip a trailing :port. Exact-match the hostname so look-alikes such as
  // `localhost.evil.com` or `127.0.0.1.attacker.net` do not slip through.
  const hostname = host.replace(/:\d+$/, "");
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function isLoopbackIp(ipRaw: string | null | undefined): boolean {
  const ip = (ipRaw || "").toLowerCase().trim();
  if (!ip) return false;
  // Normalise brackets and the IPv4-mapped-IPv6 prefix (::ffff:127.0.0.1).
  const norm = ip.replace(/^\[/, "").replace(/\]$/, "").replace(/^::ffff:/, "");
  if (norm === "::1" || ip === "::1") return true;
  return /^127\.\d+\.\d+\.\d+$/.test(norm);
}

export function isLoopbackRequest(getHeader: (name: string) => string | null | undefined): boolean {
  // Hard proxy indicators (Cloudflare tunnel, RFC 7239 Forwarded) → never local.
  for (const h of HARD_PROXY_HEADERS) {
    if (getHeader(h)) return false;
  }

  // The Host must be a loopback hostname.
  if (!isLoopbackHost(getHeader("host"))) return false;

  // If x-forwarded-host is present it must ALSO be loopback. A reverse proxy
  // sets it to the public hostname; Next sets it to the local host.
  const xfh = getHeader("x-forwarded-host");
  if (xfh && !isLoopbackHost(xfh)) return false;

  // If a client-IP forwarding header is present, its first (client) hop must be
  // a loopback address. A tunnel/proxy puts the external client IP here.
  for (const h of ["x-forwarded-for", "x-real-ip"] as const) {
    const v = getHeader(h);
    if (!v) continue;
    const first = v.split(",")[0]?.trim();
    if (!isLoopbackIp(first)) return false;
  }

  return true;
}
