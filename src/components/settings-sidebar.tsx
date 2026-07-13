"use client";

/**
 * <SettingsSidebar/> — the settings nav lifted out of the settings page so
 * it persists across navigation to admin sub-pages (/audit, /permissions,
 * etc.). Mounted globally in layout.tsx; renders null on every route that
 * isn't owned by Settings.
 *
 * In-page sections are now URL-driven via `?section=<name>` — that's what
 * lets the sidebar stay mounted across navigation: a click anywhere is a
 * regular Link, and the settings page reads its active section from the URL.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  Settings as SettingsIcon, Wrench, Wifi, Plug2, MessagesSquare, Lock, Archive,
  Shield, ScrollText, BarChart3, Activity, Users, Sparkles, Code2,
  Boxes, Search, ArrowUpRight, PanelLeftClose, PanelLeftOpen,
  Workflow, BookOpen, Plug, Box, Package, Network, Calendar,
  Database, Brain,
} from "lucide-react";

// In-page section tabs. Tools intentionally moved OUT of this list — it now
// lives under the "Context engineering" group in the sidebar, alongside system
// prompt, memory, context window, etc. The settings page still renders the
// Tools section when reached via ?section=Tools (see settings/page.tsx).
export const SETTINGS_SECTIONS = [
  { id: "General",          Icon: SettingsIcon },
  { id: "Network",          Icon: Wifi },
  { id: "Providers",        Icon: Plug2 },
  { id: "Communications",   Icon: MessagesSquare },
  { id: "Integrations",     Icon: Boxes },
  { id: "Data & Privacy",   Icon: Lock },
  { id: "Backup",           Icon: Archive },
] as const;

// Sections reachable by URL but NOT shown in the in-page tab list — they
// have their own entry points elsewhere in the sidebar.
const HIDDEN_SECTION_IDS = ["Tools"] as const;
export type HiddenSectionId = (typeof HIDDEN_SECTION_IDS)[number];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

// Routes where the Settings sidebar is hidden. The five rail destinations
// (Chat /, Work, Agents, Knowledge, Fleet) are workspace surfaces — they
// have their own first-class layout and shouldn't be crowded by a config
// sidebar. The sidebar appears on every settings / admin / config route
// instead (handled by the inverse — see shouldRender). Auth flows are also
// hidden. The user can still collapse the sidebar on its visible routes via
// the hide button, with state persisted in localStorage.
const HIDDEN_ROUTES = [
  "/",          // chat
  "/work",
  "/ops",       // Agent Ops board — full-bleed workspace surface
  "/agents",
  "/browse",    // Browse has its own chrome + Sora panel; no config sidebar
  "/knowledge",
  "/context",   // User Context Graph — full-bleed workspace surface
  "/fleet",
  "/today",
  "/login",
  "/auth",
  "/onboarding",
];

// Every non-auth route in the product, grouped semantically. The sidebar is
// the complete page index — nothing is "hidden" behind the 5-glyph rail.
// Search filters this list live, so finding any destination is one keystroke
// away. (Workspace destinations are intentionally omitted — they already live
// in the global rail.)
const ADMIN_GROUPS: { title: string; links: { href: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] }[] = [
  {
    title: "Work detail",
    links: [
      { href: "/graphs",        label: "Task graphs",  Icon: Workflow },
      { href: "/orchestration", label: "Orchestration", Icon: Network },
      { href: "/automations",   label: "Automations",  Icon: Calendar },
      { href: "/data",          label: "Data tables",  Icon: Database },
    ],
  },
  {
    // Everything that flows INTO the model on every turn lives here. Order
    // mirrors how a prompt is composed: instructions, then capabilities,
    // then recall, then retrieval, then the budget those things compete for,
    // then which model receives the final composed prompt.
    title: "Context engineering",
    links: [
      { href: "/agent/system-prompt",        label: "System prompt",   Icon: Sparkles },
      { href: "/settings?section=Tools",     label: "Tools",           Icon: Wrench },
      { href: "/knowledge?tab=memory",       label: "Memory",          Icon: Brain },
      { href: "/knowledge",                  label: "Knowledge base",  Icon: BookOpen },
      { href: "/agent/context-window",       label: "Context window",  Icon: Sparkles },
      { href: "/agent/routing",              label: "Model routing",   Icon: Sparkles },
      { href: "/agents",                     label: "Agent memory",    Icon: Brain },
    ],
  },
  {
    title: "Fleet detail",
    links: [
      { href: "/mcp",                   label: "MCP servers",       Icon: Plug },
      { href: "/models",                label: "Models",            Icon: Box },
      { href: "/plugins",               label: "Plugins",           Icon: Package },
      { href: "/knowledge?tab=sharing", label: "Knowledge sharing", Icon: BookOpen },
    ],
  },
  {
    title: "Governance",
    links: [
      { href: "/permissions", label: "Permissions",  Icon: Shield },
      { href: "/access",      label: "Users & sessions", Icon: Users },
      { href: "/audit",       label: "Audit log",    Icon: ScrollText },
    ],
  },
  {
    title: "Observability",
    links: [
      { href: "/system",    label: "System health", Icon: Activity },
      { href: "/analytics", label: "Analytics",     Icon: BarChart3 },
      { href: "/devpm",     label: "DevPM",         Icon: Code2 },
    ],
  },
];

function shouldRender(pathname: string): boolean {
  return !HIDDEN_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

const COLLAPSED_KEY = "lm.settingsSidebar.collapsed";

function SettingsSidebarInner() {
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  // Hydrate collapsed state from localStorage on mount. Default = open.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  if (!shouldRender(pathname)) return null;

  // Collapsed view: a slim re-open button anchored to the left edge.
  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        aria-label="Show settings sidebar"
        title="Show settings sidebar"
        className="hidden md:flex items-center justify-center shrink-0"
        style={{
          width: 28,
          borderRight: "1px solid hsl(0 0% 100% / 0.06)",
          background: "hsl(234 22% 4% / 0.4)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          color: "hsl(0 0% 100% / 0.55)",
          cursor: "pointer",
        }}
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
    );
  }

  const currentSection = (params.get("section") || "General") as SettingsSectionId;
  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const visibleSections = SETTINGS_SECTIONS.filter((s) => matches(s.id));
  const visibleAdminGroups = ADMIN_GROUPS
    .map((g) => ({ ...g, links: g.links.filter((l) => matches(l.label) || matches(g.title)) }))
    .filter((g) => g.links.length > 0);

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col overflow-y-auto py-10 px-5"
      style={{
        width: 240,
        borderRight: "1px solid hsl(0 0% 100% / 0.06)",
        background: "hsl(234 22% 4% / 0.4)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="lm-micro">Settings</p>
        <button
          onClick={toggleCollapsed}
          aria-label="Hide settings sidebar"
          title="Hide settings sidebar"
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "hsl(0 0% 100% / 0.4)",
            display: "flex",
            alignItems: "center",
            padding: 2,
          }}
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Jump-to search */}
      <div className="lm-settings-search mb-5">
        <Search className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.4)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to…"
          aria-label="Search settings"
          data-pulse="false"
        />
      </div>

      {/* In-page sections — Links so the sidebar can be mounted globally and
          we don't need to coordinate state across page boundaries. */}
      {visibleSections.length > 0 && (
        <nav className="space-y-0.5" aria-label="In-page sections">
          {visibleSections.map(({ id, Icon }) => {
            const active = onSettings && currentSection === id && !q;
            return (
              <Link
                key={id}
                href={`/settings?section=${encodeURIComponent(id)}`}
                className={`lm-settings-link ${active ? "is-active" : ""}`}
                data-pulse="true"
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{id}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {visibleAdminGroups.length > 0 && <div className="lm-hairline mt-6 mb-4" />}

      {visibleAdminGroups.map((g) => (
        <div key={g.title} className="mb-5">
          <p className="lm-micro mb-2" style={{ color: "hsl(0 0% 100% / 0.3)" }}>{g.title}</p>
          <nav className="space-y-0.5" aria-label={`${g.title} (external pages)`}>
            {g.links.map(({ href, label, Icon }) => {
              // Highlight the active admin link so the user knows where they
              // currently are inside the settings cluster.
              const linkActive =
                pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={`lm-settings-link is-external ${linkActive ? "is-active" : ""}`}
                  data-pulse="true"
                  aria-current={linkActive ? "page" : undefined}
                >
                  <Icon className="h-3 w-3" />
                  <span>{label}</span>
                  <ArrowUpRight
                    className="h-3 w-3 ml-auto"
                    style={{ color: "hsl(0 0% 100% / 0.3)" }}
                    aria-label="opens a separate page"
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      ))}

      {q && visibleSections.length === 0 && visibleAdminGroups.length === 0 && (
        <p className="lm-body mt-4" style={{ color: "hsl(0 0% 100% / 0.4)", fontSize: 12 }}>
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      )}
    </aside>
  );
}

export function SettingsSidebar() {
  // useSearchParams must be wrapped in Suspense in app router; the wrapper
  // also keeps the rest of the page from blocking on this small client tree.
  return (
    <Suspense fallback={null}>
      <SettingsSidebarInner />
    </Suspense>
  );
}
