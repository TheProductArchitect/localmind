"use client";

/**
 * ⌘K command palette — the primary navigation surface in v2.
 *
 * Since the rail only carries five glyphs, the palette is how users reach
 * the long tail (audit log, individual settings panes, plugin pages, etc.)
 * without bloating the nav. Grouped by the five destinations so muscle
 * memory transfers from the rail.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type Command = { label: string; href: string; group: string; hint?: string };

const COMMANDS: Command[] = [
  // Actions
  { label: "New conversation", href: "/?new=1",      group: "Actions", hint: "⌘N" },
  { label: "Toggle command palette", href: "#",      group: "Actions", hint: "⌘K" },

  // Chat
  { label: "Chat",              href: "/",           group: "Chat" },

  // Work
  { label: "Work timeline",     href: "/work",       group: "Work" },
  { label: "Agents — live + catalog", href: "/agents", group: "Work" },
  { label: "Task graphs",       href: "/graphs",     group: "Work" },
  { label: "Orchestration",     href: "/orchestration", group: "Work" },
  { label: "Automations",       href: "/automations", group: "Work" },
  { label: "Jobs",              href: "/work?tab=jobs", group: "Work" },

  // Knowledge
  { label: "Knowledge base",    href: "/knowledge",  group: "Knowledge" },
  { label: "Browse the web (secure)", href: "/browse", group: "Knowledge" },
  { label: "Memory",            href: "/knowledge?tab=memory", group: "Knowledge" },
  { label: "Data tables",       href: "/data",       group: "Knowledge" },

  // Fleet
  { label: "Fleet · peers",     href: "/fleet",      group: "Fleet" },
  { label: "MCP servers",       href: "/mcp",        group: "Fleet" },
  { label: "Models",            href: "/models",     group: "Fleet" },
  { label: "Plugins",           href: "/plugins",    group: "Fleet" },

  // Settings
  { label: "Settings",                href: "/settings",     group: "Settings" },
  { label: "Permissions",             href: "/permissions",  group: "Settings" },
  { label: "Audit log",               href: "/audit",        group: "Settings" },
  { label: "Analytics",               href: "/analytics",    group: "Settings" },
  { label: "System health",           href: "/system",       group: "Settings" },
  { label: "Access · users & roles",  href: "/access",       group: "Settings" },
  { label: "Agent · system prompt",   href: "/agent/system-prompt", group: "Settings" },
  { label: "Agent · context window",  href: "/agent/context-window", group: "Settings" },
  { label: "Agent · routing rules",   href: "/agent/routing", group: "Settings" },
  { label: "DevPM",                   href: "/devpm",        group: "Settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        router.push("/?new=1");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (!open) return null;
  const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const groups = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.group] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32"
      style={{ background: "hsl(234 22% 2% / 0.6)", backdropFilter: "blur(8px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "hsl(234 18% 7% / 0.92)",
          border: "1px solid hsl(0 0% 100% / 0.10)",
          borderRadius: 14,
          boxShadow: "0 24px 80px hsl(0 0% 0% / 0.6), 0 0 0 1px hsl(0 0% 100% / 0.04) inset",
          backdropFilter: "blur(24px) saturate(140%)",
        }}
      >
        <div className="flex items-center gap-3 px-4" style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.08)" }}>
          <Search className="h-4 w-4" style={{ color: "hsl(0 0% 100% / 0.4)" }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, pages…"
            className="flex-1 bg-transparent py-4 text-[14px] outline-none"
            style={{ color: "hsl(0 0% 100% / 0.96)" }}
            data-pulse="false"
          />
          <kbd className="lm-micro" style={{ padding: "2px 6px", border: "1px solid hsl(0 0% 100% / 0.10)", borderRadius: 4 }}>ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-2 last:mb-0">
              <p className="lm-micro px-3 py-1.5">{group}</p>
              {items.map((c) => (
                <button
                  key={c.label + c.href}
                  onClick={() => { setOpen(false); if (c.href !== "#") router.push(c.href); }}
                  className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors"
                  style={{ color: "hsl(0 0% 100% / 0.92)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(0 0% 100% / 0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span>{c.label}</span>
                  {c.hint && (
                    <span className="lm-micro" style={{ letterSpacing: "0.08em" }}>{c.hint}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="lm-body text-center py-8" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
              No matching commands.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
