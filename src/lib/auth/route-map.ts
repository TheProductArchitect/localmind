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
  { path: "/api/channels/*", methods: "ALL", role: "public" },
  { path: "/api/webhooks/*", methods: "ALL", role: "public" },
  { path: "/api/internal/*", methods: "ALL", role: "public" },
  { path: "/api/v1", methods: "ALL", role: "public" },

  // --- Chat & conversations ---
  { path: "/api/chat", methods: ["POST"], role: "authenticated" },
  { path: "/api/chat/confirm", methods: ["POST"], role: "authenticated" },
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

  // --- Settings ---
  { path: "/api/settings", methods: ["GET"], role: "authenticated" },
  { path: "/api/settings", methods: ["PATCH"], role: "owner" },
  { path: "/api/settings/export", methods: "ALL", role: "owner" },
  { path: "/api/settings/api-token", methods: "ALL", role: "owner" },

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
  { path: "/api/providers", methods: "ALL", role: "owner" },

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
];

const RANK: Record<RouteRole, number> = { public: 0, authenticated: 1, member: 2, owner: 3 };

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
