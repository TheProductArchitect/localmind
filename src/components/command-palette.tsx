"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const COMMANDS = [
  { label: "Go to Chat", href: "/" },
  { label: "Go to Permissions", href: "/permissions" },
  { label: "Go to Audit Log", href: "/audit" },
  { label: "Go to Model Manager", href: "/models" },
  { label: "Go to System Dashboard", href: "/system" },
  { label: "Go to Settings", href: "/settings" },
  { label: "New conversation", href: "/?new=1" },
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-32"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, pages…"
            className="flex-1 bg-transparent py-3 text-sm outline-none"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.label}
              onClick={() => { setOpen(false); router.push(c.href); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
            >
              {c.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">No matching commands.</p>
          )}
        </div>
      </div>
    </div>
  );
}
