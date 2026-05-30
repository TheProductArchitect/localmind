"use client";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { MainNav } from "./sidebar";

// Hamburger + slide-in sheet for small screens.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
        className="fixed top-2 left-2 z-30 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-card shadow-soft transition-colors hover:bg-accent"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-64 bg-card border-r border-border/70 flex flex-col shadow-lift animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-5 h-16 shrink-0 border-b border-border/70">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft">
                <span className="text-sm font-bold tracking-tight">LM</span>
              </div>
              <span className="font-semibold tracking-tight flex-1">LocalMind</span>
              <button
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden" onClick={() => setOpen(false)}>
              <MainNav />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
