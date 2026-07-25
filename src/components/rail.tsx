"use client";

/**
 * <Rail/> — vertical nav with the primary destinations.
 *
 * Replaces the legacy MainNav + MobileNav. Glyphs only; labels appear on
 * hover via a floating chip so the rail itself stays a quiet vertical line.
 * The orb at the bottom polls /api/pulse and mirrors whatever Sora is doing
 * across the whole product — chat or background.
 *
 * On viewports below md the desktop Rail hides and <RailMobile/> takes
 * over as a horizontal glass bar pinned to the bottom edge.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MessageSquare,    // Chat
  Workflow,         // Work
  Columns3,         // Ops (Kanban)
  FolderGit2,       // Projects (coding sessions)
  Globe,            // Browse
  BookOpen,         // Knowledge (incl. the "About you" context graph)
  Wifi,             // Fleet
  SlidersHorizontal,// Settings
} from "lucide-react";
import { Orb } from "@/components/orb";
import { cn } from "@/lib/utils";
import { subscribePulse, type Pulse } from "@/lib/client/pulse-store";

type Dest = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  matches: string[];
};

const DESTS: Dest[] = [
  { href: "/",          label: "Chat",      Icon: MessageSquare,     matches: ["/"] },
  { href: "/work",      label: "Work",      Icon: Workflow,          matches: ["/work", "/graphs", "/orchestration", "/automations", "/agents", "/today", "/presentations"] },
  { href: "/ops",       label: "Ops",       Icon: Columns3,          matches: ["/ops"] },
  { href: "/projects",  label: "Projects",  Icon: FolderGit2,        matches: ["/projects"] },
  { href: "/browse",    label: "Browse",    Icon: Globe,             matches: ["/browse"] },
  { href: "/knowledge", label: "Knowledge", Icon: BookOpen,          matches: ["/knowledge", "/memory", "/data", "/context"] },
  { href: "/fleet",     label: "Fleet",     Icon: Wifi,              matches: ["/fleet", "/mcp", "/models", "/plugins"] },
  { href: "/settings",  label: "Settings",  Icon: SlidersHorizontal, matches: ["/settings", "/permissions", "/access", "/audit", "/analytics", "/system", "/devpm", "/agent"] },
];

function isActive(path: string, dest: Dest): boolean {
  if (dest.href === "/") return path === "/";
  return dest.matches.some((m) => path === m || path.startsWith(m + "/"));
}

function usePulse(): Pulse {
  const [pulse, setPulse] = useState<Pulse>({
    state: "idle",
    processes: 0,
    graphs: 0,
    subagents: 0,
    suspended: false,
  });
  useEffect(() => subscribePulse(setPulse), []);
  return pulse;
}

function pulseLabel(p: Pulse): string {
  if (p.suspended) return "Sora — suspended";
  if (p.state === "spawn") return `Sora — ${p.subagents} subagent${p.subagents === 1 ? "" : "s"}`;
  if (p.state === "thinking") {
    const n = p.processes + p.graphs;
    return `Sora — ${n} active`;
  }
  return "Sora — idle";
}

export function Rail() {
  const path = usePathname();
  const pulse = usePulse();
  const hideOn = ["/login", "/onboarding"];
  if (hideOn.some((p) => path === p || path.startsWith(p + "/"))) return null;

  return (
    <>
      {/* Desktop — vertical rail */}
      <aside
        className="hidden md:flex shrink-0 flex-col items-center justify-between py-5 z-30"
        style={{
          width: 56,
          borderRight: "1px solid hsl(0 0% 100% / 0.06)",
          background: "hsl(234 22% 4% / 0.6)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        <Link
          href="/"
          className="lm-micro select-none"
          style={{ writingMode: "vertical-rl", letterSpacing: "0.25em", color: "hsl(0 0% 100% / 0.5)" }}
          data-pulse="true"
          aria-label="LocalMind home"
        >
          LM
        </Link>

        <nav className="flex flex-col items-center gap-1">
          {DESTS.map((d) => {
            const active = isActive(path, d);
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-label={d.label}
                data-pulse="true"
                className={cn("lm-rail-link", active && "is-active")}
              >
                <d.Icon className="h-[18px] w-[18px]" />
                <span className="lm-rail-tip">{d.label}</span>
              </Link>
            );
          })}
        </nav>

        <div title={pulseLabel(pulse)} aria-label={pulseLabel(pulse)}>
          <Orb
            state={pulse.state}
            size={28}
            satellites={Math.max(1, Math.min(pulse.subagents || 3, 6))}
            ariaLabel={pulseLabel(pulse)}
          />
        </div>
      </aside>

      {/* Mobile — horizontal bottom rail */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2"
        style={{
          borderTop: "1px solid hsl(0 0% 100% / 0.08)",
          background: "hsl(234 22% 4% / 0.7)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        {DESTS.map((d) => {
          const active = isActive(path, d);
          return (
            <Link
              key={d.href}
              href={d.href}
              aria-label={d.label}
              data-pulse="true"
              className={cn("lm-rail-link", active && "is-active")}
            >
              <d.Icon className="h-[18px] w-[18px]" />
            </Link>
          );
        })}
        <div className="px-2" title={pulseLabel(pulse)}>
          <Orb
            state={pulse.state}
            size={24}
            satellites={Math.max(1, Math.min(pulse.subagents || 3, 6))}
            ariaLabel={pulseLabel(pulse)}
          />
        </div>
      </nav>

      <style jsx>{`
        .lm-rail-link {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 12px;
          color: hsl(0 0% 100% / 0.45);
          transition: background var(--lm-dur-micro) var(--lm-ease-micro),
                      color      var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-rail-link:hover {
          color: hsl(0 0% 100% / 0.92);
          background: hsl(0 0% 100% / 0.05);
        }
        .lm-rail-link.is-active {
          color: hsl(0 0% 100%);
          background: hsl(0 0% 100% / 0.08);
          box-shadow: 0 0 0 1px hsl(0 0% 100% / 0.10) inset;
        }
        /* Active accent line — vertical on desktop, hidden on mobile */
        @media (min-width: 768px) {
          .lm-rail-link.is-active::before {
            content: "";
            position: absolute;
            left: -10px;
            top: 50%;
            width: 2px;
            height: 18px;
            background: white;
            border-radius: 2px;
            transform: translateY(-50%);
            box-shadow: 0 0 10px hsl(0 0% 100% / 0.7);
          }
        }
        .lm-rail-tip {
          position: absolute;
          left: 50px;
          top: 50%;
          transform: translateY(-50%);
          padding: 4px 10px;
          font-size: 12px;
          letter-spacing: -0.005em;
          color: hsl(0 0% 100% / 0.92);
          background: hsl(234 18% 8% / 0.85);
          border: 1px solid hsl(0 0% 100% / 0.10);
          border-radius: 8px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          backdrop-filter: blur(12px);
          transition: opacity var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-rail-link:hover .lm-rail-tip { opacity: 1; }
      `}</style>
    </>
  );
}
