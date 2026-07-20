// Authorization map for every API route. The middleware looks up the minimum
// role here. Routes not listed default to "owner" as a safe fallback.
//
// role: "public"        — no authentication
//       "authenticated" — any valid JWT
//       "member"        — member or owner
//       "owner"         — owner only

export type RouteRole = "public" | "authenticated" | "member" | "owner";
export type RouteEntry = { path: string; methods: string[] | "ALL"; role: RouteRole };

export const ROUTE_MAP: readonly RouteEntry[] = [
  // --- Health & auth ---
  { path: "/api/health", methods: "ALL", role: "public" },
  { path: "/api/auth/login", methods: ["POST"], role: "public" },
  { path: "/api/auth/logout", methods: ["POST"], role: "public" },
  { path: "/api/auth/refresh", methods: ["POST"], role: "public" },
  { path: "/api/auth/bootstrap", methods: ["POST"], role: "public" },
  { path: "/api/auth/me", methods: "ALL", role: "public" },
  { path: "/api/auth/passkey/register/*", methods: "ALL", role: "authenticated" },
  { path: "/api/auth/passkey/authenticate/*", methods: "ALL", role: "public" },

  // --- Inbound channel webhooks (carry their own HMAC/token) ---
  { path: "/api/channels", methods: ["GET"], role: "authenticated" },
  { path: "/api/channels", methods: ["POST"], role: "owner" },
  { path: "/api/channels/*", methods: "ALL", role: "public" },
  { path: "/api/webhooks/*", methods: "ALL", role: "public" },
  { path: "/api/internal/*", methods: "ALL", role: "public" },
  { path: "/api/v1", methods: "ALL", role: "public" },

  // --- Chat & conversations ---
  { path: "/api/chat", methods: ["POST"], role: "authenticated" },
  { path: "/api/chat/confirm", methods: ["POST"], role: "authenticated" },
  { path: "/api/chat/resume", methods: ["GET", "POST"], role: "authenticated" },
  { path: "/api/conversations", methods: "ALL", role: "authenticated" },
  { path: "/api/conversations/search", methods: "ALL", role: "authenticated" },
  { path: "/api/conversations/*", methods: "ALL", role: "authenticated" },

  // --- Models ---
  { path: "/api/models", methods: ["GET"], role: "authenticated" },
  { path: "/api/models/pull", methods: ["POST"], role: "member" },
  { path: "/api/models/*", methods: ["DELETE"], role: "owner" },

  // --- Memory ---
  { path: "/api/memory", methods: "ALL", role: "authenticated" },
  { path: "/api/memory/*", methods: "ALL", role: "authenticated" },

  // --- Knowledge base ---
  // Owner-only share-policy MUST sit above the /api/knowledge/* wildcard —
  // first-match wins, so a later owner entry would never run.
  { path: "/api/knowledge/share-policy", methods: ["GET"], role: "owner" },
  { path: "/api/knowledge/share-policy/*", methods: ["GET", "PUT", "DELETE"], role: "owner" },
  { path: "/api/knowledge/peer-search", methods: ["POST"], role: "authenticated" },
  { path: "/api/knowledge/*", methods: "ALL", role: "authenticated" },

  // --- Audit log ---
  { path: "/api/audit", methods: ["GET"], role: "authenticated" },
  { path: "/api/audit/export", methods: "ALL", role: "owner" },
  { path: "/api/audit/verify", methods: ["POST"], role: "owner" },

  // --- System ---
  { path: "/api/system/health", methods: "ALL", role: "owner" },
  { path: "/api/system/performance", methods: "ALL", role: "owner" },
  { path: "/api/system/logs", methods: "ALL", role: "owner" },
  { path: "/api/system/services/*", methods: "ALL", role: "owner" },
  { path: "/api/system/always-on", methods: "ALL", role: "owner" },

  // --- Settings ---
  { path: "/api/settings", methods: ["GET"], role: "authenticated" },
  { path: "/api/settings", methods: ["PATCH"], role: "owner" },
  { path: "/api/settings/export", methods: "ALL", role: "owner" },
  { path: "/api/settings/api-token", methods: "ALL", role: "owner" },

  // --- Web guard + Browse ---
  // Site grants and the kill switch shape what every agent can reach — owner only.
  { path: "/api/web-guard/*", methods: "ALL", role: "owner" },
  // Browsing through the secure pipeline is fine for any signed-in user; the
  // guard itself still applies per-request.
  { path: "/api/browse", methods: ["POST"], role: "authenticated" },
  { path: "/api/browse/*", methods: "ALL", role: "authenticated" },
  { path: "/api/browse/session", methods: ["POST"], role: "authenticated" },
  { path: "/api/browse/session/*", methods: "ALL", role: "authenticated" },

  // --- Backup ---
  { path: "/api/backup", methods: "ALL", role: "owner" },
  { path: "/api/backup/*", methods: "ALL", role: "owner" },

  // --- Permissions ---
  { path: "/api/permissions", methods: ["GET"], role: "authenticated" },
  { path: "/api/permissions", methods: ["PATCH", "POST"], role: "owner" },

  // --- MCP ---
  { path: "/api/mcp", methods: "ALL", role: "owner" },
  { path: "/api/mcp/*", methods: "ALL", role: "owner" },

  // --- Providers ---
  { path: "/api/providers", methods: ["GET"], role: "authenticated" },
  { path: "/api/providers", methods: ["POST"], role: "owner" },

  // --- Users & roles ---
  { path: "/api/users", methods: "ALL", role: "owner" },
  { path: "/api/users/*", methods: "ALL", role: "owner" },
  { path: "/api/roles", methods: ["GET"], role: "authenticated" },
  { path: "/api/roles", methods: ["POST"], role: "owner" },

  // --- Sessions ---
  { path: "/api/sessions", methods: "ALL", role: "authenticated" },
  { path: "/api/sessions/*", methods: "ALL", role: "authenticated" },

  // --- Workflows & automations ---
  { path: "/api/workflows", methods: "ALL", role: "authenticated" },
  { path: "/api/workflows/*", methods: "ALL", role: "authenticated" },
  { path: "/api/automations/*", methods: "ALL", role: "authenticated" },

  // --- Goals & proactive ---
  { path: "/api/goals", methods: "ALL", role: "authenticated" },
  { path: "/api/goals/*", methods: "ALL", role: "authenticated" },
  { path: "/api/proactive/*", methods: "ALL", role: "authenticated" },
  { path: "/api/focus", methods: "ALL", role: "authenticated" },

  // --- DevPM ---
  { path: "/api/devpm/*", methods: "ALL", role: "authenticated" },

  // --- Communications & tools ---
  { path: "/api/comms/*", methods: "ALL", role: "owner" },
  { path: "/api/tools/verify", methods: "ALL", role: "owner" },

  // --- Updates & misc ---
  { path: "/api/updates/*", methods: "ALL", role: "owner" },
  { path: "/api/data", methods: "ALL", role: "owner" },
  { path: "/api/voice/*", methods: "ALL", role: "authenticated" },

  // --- V5: Agent configuration (personas, system prompt blocks) ---
  { path: "/api/agent/personas", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/personas", methods: ["POST"], role: "owner" },
  // No GET-by-id handler — list is GET /api/agent/personas; mutate via PATCH/DELETE.
  { path: "/api/agent/personas/*", methods: ["PATCH", "DELETE"], role: "owner" },
  { path: "/api/agent/system-prompt/*", methods: ["GET", "POST"], role: "authenticated" },
  { path: "/api/agent/system-prompt/*", methods: ["PATCH"], role: "owner" },

  // --- V5: Context window settings + per-model overrides ---
  { path: "/api/agent/context-settings", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/context-settings", methods: ["PATCH"], role: "owner" },
  { path: "/api/agent/context-settings/*", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/context-settings/*", methods: ["PATCH"], role: "owner" },
  { path: "/api/agent/model-context-overrides", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/model-context-overrides/*", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/model-context-overrides/*", methods: ["PUT", "DELETE"], role: "owner" },

  // --- V5: Orchestration (processes, trace, pause/resume/cancel) ---
  { path: "/api/orchestration/processes", methods: ["GET"], role: "authenticated" },
  { path: "/api/orchestration/processes/*", methods: ["GET", "DELETE", "POST"], role: "authenticated" },

  // --- Ops board: self-improvement proposals (approval is owner-only, §7.2) ---
  { path: "/api/ops/proposals", methods: ["GET"], role: "authenticated" },
  { path: "/api/ops/proposals", methods: ["POST"], role: "owner" },
  { path: "/api/ops/proposals/*", methods: ["POST"], role: "owner" },
  { path: "/api/ops/self-checks", methods: ["GET"], role: "authenticated" },
  { path: "/api/ops/meta", methods: ["GET"], role: "authenticated" },

  // --- User Context Graph (per-user; read-only in phase 1, §12) ---
  { path: "/api/context/graph", methods: ["GET"], role: "authenticated" },
  { path: "/api/context/meta", methods: ["GET"], role: "authenticated" },

  // --- Brain entity graph (queryable) ---
  { path: "/api/brain/edges", methods: ["GET"], role: "authenticated" },

  // --- V5: Long-running jobs ---
  { path: "/api/jobs", methods: ["GET", "POST"], role: "authenticated" },
  { path: "/api/jobs/*", methods: ["GET", "DELETE", "POST"], role: "authenticated" },

  // --- V5: Plugins (marketplace + installed) ---
  { path: "/api/plugins", methods: ["GET"], role: "authenticated" },
  { path: "/api/plugins", methods: ["PATCH"], role: "owner" },
  { path: "/api/plugins/registry", methods: ["GET"], role: "authenticated" },
  { path: "/api/plugins/install", methods: ["POST"], role: "owner" },
  { path: "/api/plugins/*", methods: ["GET"], role: "authenticated" },
  { path: "/api/plugins/*", methods: ["DELETE", "POST"], role: "owner" },

  // --- V5: Structured data outputs (datastore + spreadsheets) ---
  { path: "/api/data/tables", methods: "ALL", role: "authenticated" },
  { path: "/api/data/tables/*", methods: "ALL", role: "authenticated" },
  { path: "/api/data/spreadsheets", methods: "ALL", role: "authenticated" },
  { path: "/api/data/spreadsheets/*", methods: "ALL", role: "authenticated" },

  // --- V5: Multi-model routing rules ---
  { path: "/api/agent/routing-rules", methods: ["GET"], role: "authenticated" },
  { path: "/api/agent/routing-rules", methods: ["POST"], role: "owner" },
  { path: "/api/agent/routing-rules/*", methods: ["PATCH", "DELETE"], role: "owner" },

  // --- V6.0 fleet foundation ---
  // identity endpoint is owner-readable (it's part of the pairing flow — only
  // the owner should be able to display the QR). The mTLS peer endpoints will
  // ship in V6.1 with their own middleware that pre-empts the JWT check.
  { path: "/api/fleet/identity", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-envelope", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-loopback", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-pairing", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-graph", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-delegate", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-placement", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-knowledge", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-tool-cache", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-peer-knowledge", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-voice-pi-mcp", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-sora", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-orchestration", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-governor", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-loop-guard", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/debug-sanitize", methods: ["GET"], role: "owner" },
  { path: "/api/agent/memory/*", methods: "ALL", role: "authenticated" },
  { path: "/api/agent/critic/*", methods: ["GET"], role: "authenticated" },
  { path: "/api/analytics", methods: ["GET"], role: "authenticated" },
  { path: "/api/pulse", methods: ["GET"], role: "authenticated" },
  { path: "/api/tools", methods: ["GET"], role: "authenticated" },
  { path: "/api/integrations", methods: ["GET"], role: "authenticated" },

  // V6.8: Task graphs UI surface.
  { path: "/api/graphs", methods: ["GET"], role: "authenticated" },
  { path: "/api/graphs/*", methods: ["GET", "DELETE"], role: "authenticated" },
  { path: "/api/audit/*", methods: ["GET"], role: "authenticated" },

  // V6.2: Pairing flow + peers CRUD. All gated owner — fleet management is
  // an admin operation by design.
  { path: "/api/fleet/pair/start", methods: ["POST"], role: "owner" },
  { path: "/api/fleet/pair/accept", methods: ["POST"], role: "owner" },
  { path: "/api/fleet/peers", methods: ["GET"], role: "owner" },
  { path: "/api/fleet/peers/*", methods: ["GET", "PATCH", "DELETE"], role: "owner" },
  { path: "/api/fleet/sync", methods: ["POST"], role: "authenticated" },
  { path: "/api/fleet/chat-placement", methods: ["GET"], role: "authenticated" },
  // Chat relay is per-authenticated-user (not owner-only) since each user on
  // this node should be able to drive their own peer chats; the peer's
  // accept_chat_relay flag is the trust gate, not user role on this side.
  { path: "/api/fleet/peers/*/chat", methods: ["POST"], role: "authenticated" },
];

// User roles include `guest` (not a RouteRole); guest satisfies `authenticated`.
const RANK: Record<string, number> = {
  public: 0,
  guest: 1,
  authenticated: 1,
  member: 2,
  owner: 3,
};

// Matches a route path against a pattern with "*" wildcards on path segments.
function matches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  const pp = pattern.split("/");
  const xp = path.split("/");
  if (pp[pp.length - 1] === "*") {
    // Trailing wildcard matches this segment and anything deeper.
    if (xp.length < pp.length) return false;
    for (let i = 0; i < pp.length - 1; i++) {
      if (pp[i] !== "*" && pp[i] !== xp[i]) return false;
    }
    return true;
  }
  if (pp.length !== xp.length) return false;
  return pp.every((seg, i) => seg === "*" || seg === xp[i]);
}

// Returns the minimum role required for a request, or "owner" if unmatched.
export function requiredRoleFor(path: string, method: string): RouteRole {
  for (const entry of ROUTE_MAP) {
    if (!matches(entry.path, path)) continue;
    if (entry.methods === "ALL" || entry.methods.includes(method)) return entry.role;
  }
  return "owner";
}

export function roleSatisfies(userRole: string, required: RouteRole): boolean {
  const r = RANK[(userRole as RouteRole)] ?? -1;
  return r >= RANK[required];
}
