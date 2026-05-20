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
        className="fixed top-2 left-2 z-30 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-60 bg-background border-r flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center px-4 py-4 border-b">
              <span className="font-semibold text-lg flex-1">LocalMind</span>
              <button aria-label="Close navigation menu" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div onClick={() => setOpen(false)}>
              <MainNav />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
