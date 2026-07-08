/**
 * Web-access guard — LocalMind's port of Nova's three-layer DOM-access model.
 *
 * Every tool that reaches the web calls `checkWebAccess()` BEFORE any network
 * I/O. The layers, evaluated in order:
 *
 *   Layer 3 (kill switch)   settings.web_access_killed=1 severs everything.
 *                           Checked first because it must win over any grant.
 *   Layer 2 (site grants)   per-domain standing policy: 'never' blocks the
 *                           domain outright; 'allow' opts it in even when
 *                           Layer 1 would class it sensitive.
 *   Layer 1 (sensitive      domains that are banking / government / health /
 *   context)                webmail are blind by default. Protection that
 *                           doesn't depend on the user predicting danger.
 *
 * The guard is enforced at the tool layer, not inside the model's prompt —
 * an injected instruction can't skip a check the agent code never branches
 * around. Page-level sensitivity (password fields) is enforced one layer
 * deeper still, inside the Secure Browser MCP itself, which refuses to
 * return login-page content unless the caller passes allow_sensitive=true —
 * which this guard only grants for explicitly-allowed domains.
 */

import { getConfigDb } from "../db";
import { getSettings } from "../db/queries";
import { logSecurityEvent } from "../db/jobs";

export type SiteGrant = {
  domain: string;
  policy: "allow" | "never";
  note: string | null;
  created_at: number;
};

export type WebAccessCheck =
  | { ok: true; allowSensitive: boolean }
  | { ok: false; reason: string };

// Layer 1 heuristics. Deliberately conservative and category-based — this is
// a default-blind list, not a blocklist. The user can opt any of these in
// with an explicit 'allow' grant. Patterns match the registrable domain and
// any subdomain.
const SENSITIVE_DOMAIN_PATTERNS: RegExp[] = [
  // Banking / payments
  /(^|\.)(chase|bankofamerica|wellsfargo|citi|citibank|capitalone|usbank|pnc|truist|ally|schwab|fidelity|vanguard|paypal|venmo|wise|revolut)\.com$/i,
  /(^|\.)([a-z0-9-]+)?bank[a-z0-9-]*\.(com|net|org|co|io)$/i,
  /(^|\.)(coinbase|kraken|binance)\.(com|us)$/i,
  // Government
  /\.gov$/i,
  /\.gov\.[a-z]{2}$/i,
  /\.mil$/i,
  // Health
  /(^|\.)(mychart|healthgrades|zocdoc|goodrx)\.(com|org)$/i,
  /(^|\.)([a-z0-9-]+)?health[a-z0-9-]*\.(com|org|net)$/i,
  // Webmail (agent reading your inbox through the browser bypasses the
  // gated email tool — keep it blind unless explicitly allowed)
  /(^|\.)(mail\.google|outlook\.live|outlook\.office|mail\.yahoo|mail\.proton|protonmail)\.(com|ch)$/i,
];

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isSensitiveDomain(domain: string): boolean {
  return SENSITIVE_DOMAIN_PATTERNS.some((re) => re.test(domain));
}

// ---- site_grants CRUD ----

export function listSiteGrants(): SiteGrant[] {
  return getConfigDb()
    .prepare("SELECT * FROM site_grants ORDER BY created_at DESC")
    .all() as SiteGrant[];
}

export function setSiteGrant(domain: string, policy: "allow" | "never", note?: string) {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) {
    throw new Error(`'${domain}' is not a valid domain`);
  }
  getConfigDb()
    .prepare(
      `INSERT INTO site_grants (domain, policy, note, created_at) VALUES (?,?,?,?)
       ON CONFLICT(domain) DO UPDATE SET policy=excluded.policy, note=excluded.note`
    )
    .run(d, policy, note || null, Date.now());
  logSecurityEvent("site_grant_set", `${d} → ${policy}`);
}

export function removeSiteGrant(domain: string) {
  getConfigDb().prepare("DELETE FROM site_grants WHERE domain=?").run(domain.toLowerCase());
  logSecurityEvent("site_grant_removed", domain.toLowerCase());
}

/** Longest-suffix grant lookup: a grant on example.com covers docs.example.com. */
function grantFor(domain: string): SiteGrant | null {
  const db = getConfigDb();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const g = db.prepare("SELECT * FROM site_grants WHERE domain=?").get(candidate) as
      | SiteGrant
      | undefined;
    if (g) return g;
  }
  return null;
}

// ---- The guard ----

/**
 * @param url  Absent for tools that hit the web without a user-visible URL
 *             (web_search). Those are only subject to the kill switch.
 */
export function checkWebAccess(url?: string): WebAccessCheck {
  const s = getSettings();
  if (s.web_access_killed) {
    return {
      ok: false,
      reason:
        "Web access is severed by the kill switch (Settings → Web access). No agent may reach the web until the user re-enables it.",
    };
  }
  if (!url) return { ok: true, allowSensitive: false };

  const domain = domainOf(url);
  if (!domain) return { ok: false, reason: `'${url}' is not a valid URL.` };

  const grant = grantFor(domain);
  if (grant?.policy === "never") {
    return {
      ok: false,
      reason: `The user has blocked agent access to ${grant.domain} (site grant: never). Do not attempt to read this site through any other tool.`,
    };
  }
  if (grant?.policy === "allow") {
    return { ok: true, allowSensitive: true };
  }
  if (isSensitiveDomain(domain)) {
    return {
      ok: false,
      reason: `${domain} is classed as a sensitive site (banking/government/health/webmail) and agents are blind to it by default. The user can grant access under Settings → Web access → Site grants.`,
    };
  }
  return { ok: true, allowSensitive: false };
}

/** Every successful page read lands in the security audit trail. */
export function auditPageRead(tool: string, url: string, userId?: string) {
  logSecurityEvent("page_read", `${tool} → ${url}`, userId);
}
