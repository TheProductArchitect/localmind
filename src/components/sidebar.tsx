"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Shield, ScrollText, Box, Activity, Settings as SettingsIcon,
  Plug, BookOpen, Workflow, Users, Code2, Sun,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      { href: "/", label: "Chat", icon: MessageSquare },
      { href: "/today", label: "Today", icon: Sun },
      { href: "/devpm", label: "DevPM", icon: Code2 },
      { href: "/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/automations", label: "Automations", icon: Workflow },
      { href: "/mcp", label: "MCP Servers", icon: Plug },
    ],
  },
  {
    title: "Access & Security",
    items: [
      { href: "/access", label: "Access", icon: Users },
      { href: "/permissions", label: "Permissions", icon: Shield },
      { href: "/audit", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/models", label: "Models", icon: Box },
      { href: "/system", label: "System", icon: Activity },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function MainNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group.title}
          </p>
          {group.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ease-spring",
                  active
                    ? "bg-card font-medium text-foreground shadow-soft"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-all duration-200 ease-spring",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                  )}
                />
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-brand" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
