"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const COMMANDS = [
  { label: "New conversation", href: "/?new=1", group: "Actions" },
  { label: "Go to Chat", href: "/", group: "Workspace" },
  { label: "Go to Today", href: "/today", group: "Workspace" },
  { label: "Go to DevPM", href: "/devpm", group: "Workspace" },
  { label: "Go to Knowledge", href: "/knowledge", group: "Workspace" },
  { label: "Go to Automations", href: "/automations", group: "Automation" },
  { label: "Go to MCP Servers", href: "/mcp", group: "Automation" },
  { label: "Go to Access", href: "/access", group: "Access & Security" },
  { label: "Go to Permissions", href: "/permissions", group: "Access & Security" },
  { label: "Go to Audit Log", href: "/audit", group: "Access & Security" },
  { label: "Go to Model Manager", href: "/models", group: "System" },
  { label: "Go to System Dashboard", href: "/system", group: "System" },
  { label: "Go to Settings", href: "/settings", group: "System" },
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
  const groups = filtered.reduce<Record<string, typeof COMMANDS>>((acc, c) => {
    (acc[c.group] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-32 animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border/70 bg-card shadow-lift overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border/70 px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, pages…"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-1.5 last:mb-0">
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </p>
              {items.map((c) => (
                <button
                  key={c.label}
                  onClick={() => { setOpen(false); router.push(c.href); }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching commands.</p>
          )}
        </div>
      </div>
    </div>
  );
}
