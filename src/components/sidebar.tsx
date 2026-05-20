"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Shield, ScrollText, Box, Activity, Settings as SettingsIcon,
  Plug, BookOpen, Workflow, Users, Code2, Sun,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/today", label: "Today", icon: Sun },
  { href: "/devpm", label: "DevPM", icon: Code2 },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/mcp", label: "MCP Servers", icon: Plug },
  { href: "/access", label: "Access", icon: Users },
  { href: "/permissions", label: "Permissions", icon: Shield },
  { href: "/audit", label: "Audit Log", icon: ScrollText },
  { href: "/models", label: "Models", icon: Box },
  { href: "/system", label: "System", icon: Activity },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function MainNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
