"use client";

/**
 * ⌘K command palette — primary navigation for the long tail.
 *
 * Soft overlay mount, arrow-key selection, Enter to run. Groups follow
 * the rail destinations so muscle memory transfers.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { openReportImprovement } from "@/lib/client/report-improvement";

type Command = { label: string; href: string; group: string; hint?: string };

const COMMANDS: Command[] = [
  { label: "New conversation", href: "/?new=1", group: "Actions", hint: "⌘N" },
  { label: "Toggle command palette", href: "#", group: "Actions", hint: "⌘K" },
  { label: "Report improvement", href: "#report", group: "Actions", hint: "⌘⇧F" },

  { label: "Chat", href: "/", group: "Chat" },

  { label: "Work timeline", href: "/work", group: "Work" },
  { label: "Agent Ops board", href: "/ops", group: "Work" },
  { label: "Projects — coding sessions", href: "/projects", group: "Work" },
  { label: "Presentations — slide decks", href: "/presentations", group: "Work" },
  { label: "Agents — live + catalog", href: "/agents", group: "Work" },
  { label: "Task graphs", href: "/graphs", group: "Work" },
  { label: "Orchestration", href: "/orchestration", group: "Work" },
  { label: "Automations", href: "/automations", group: "Work" },
  { label: "Today — briefing & goals", href: "/today", group: "Work" },
  { label: "Jobs", href: "/work?tab=jobs", group: "Work" },
  { label: "Processes", href: "/work?tab=processes", group: "Work" },

  { label: "Knowledge base", href: "/knowledge", group: "Knowledge" },
  { label: "Browse the web", href: "/browse", group: "Knowledge" },
  { label: "Memory", href: "/knowledge?tab=memory", group: "Knowledge" },
  { label: "My context — what Sora knows about me", href: "/knowledge?tab=context", group: "Knowledge" },
  { label: "Knowledge sharing", href: "/knowledge?tab=sharing", group: "Knowledge" },
  { label: "Peer search", href: "/knowledge?tab=peer", group: "Knowledge" },
  { label: "Data tables", href: "/data", group: "Knowledge" },

  { label: "Fleet · peers", href: "/fleet", group: "Fleet" },
  { label: "MCP servers", href: "/mcp", group: "Fleet" },
  { label: "Models", href: "/models", group: "Fleet" },
  { label: "Plugins", href: "/plugins", group: "Fleet" },

  { label: "Settings", href: "/settings", group: "Settings" },
  { label: "Settings · Reach", href: "/settings?section=Reach", group: "Settings" },
  { label: "Settings · Providers", href: "/settings?section=Providers", group: "Settings" },
  { label: "Settings · Tools", href: "/settings?section=Tools", group: "Settings" },
  { label: "Permissions", href: "/permissions", group: "Settings" },
  { label: "Audit log", href: "/audit", group: "Settings" },
  { label: "Analytics", href: "/analytics", group: "Settings" },
  { label: "System health", href: "/system", group: "Settings" },
  { label: "Access · users & roles", href: "/access", group: "Settings" },
  { label: "Agent · system prompt", href: "/agent/system-prompt", group: "Settings" },
  { label: "Agent · context window", href: "/agent/context-window", group: "Settings" },
  { label: "Agent · routing rules", href: "/agent/routing", group: "Settings" },
  { label: "DevPM", href: "/devpm", group: "Settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();

  const filtered = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [q]
  );

  const groups = useMemo(
    () =>
      filtered.reduce<Record<string, Command[]>>((acc, c) => {
        (acc[c.group] ||= []).push(c);
        return acc;
      }, {}),
    [filtered]
  );

  // Memoized so the keydown listener below can depend on it without
  // re-subscribing on every render.
  const runCommand = useCallback(
    (cmd: Command) => {
      setOpen(false);
      setQ("");
      if (cmd.href === "#report") {
        openReportImprovement();
        return;
      }
      if (cmd.href === "#") return;
      router.push(cmd.href);
    },
    [router]
  );

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        router.push("/?new=1");
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[active];
        if (!cmd) return;
        runCommand(cmd);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, open, filtered, active, runCommand]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32 lm-overlay-in"
      style={{ background: "hsl(234 22% 2% / 0.6)", backdropFilter: "blur(8px)" }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden lm-panel-in"
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
            aria-autocomplete="list"
            aria-controls="lm-cmdk-list"
          />
          <kbd className="lm-micro" style={{ padding: "2px 6px", border: "1px solid hsl(0 0% 100% / 0.10)", borderRadius: 4 }}>ESC</kbd>
        </div>
        <div id="lm-cmdk-list" className="max-h-96 overflow-y-auto p-2" role="listbox">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-2 last:mb-0">
              <p className="lm-micro px-3 py-1.5">{group}</p>
              {items.map((c) => {
                flatIndex += 1;
                const idx = flatIndex;
                const isActive = idx === active;
                return (
                  <button
                    key={c.label + c.href}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => runCommand(c)}
                    onMouseEnter={() => setActive(idx)}
                    className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px]"
                    style={{
                      color: "hsl(0 0% 100% / 0.92)",
                      background: isActive ? "hsl(0 0% 100% / 0.08)" : "transparent",
                      transition: "background var(--lm-dur-micro) var(--lm-ease-micro)",
                    }}
                  >
                    <span>{c.label}</span>
                    {c.hint && (
                      <span className="lm-micro" style={{ letterSpacing: "0.08em" }}>{c.hint}</span>
                    )}
                  </button>
                );
              })}
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
