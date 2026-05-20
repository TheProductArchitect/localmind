import type { Metadata } from "next";
import "./globals.css";
import { MainNav } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import { DiskBanner } from "@/components/disk-banner";

export const metadata: Metadata = {
  title: "LocalMind",
  description: "A local-first AI control panel for Mac",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex flex-col h-screen overflow-hidden">
          <DiskBanner />
          <div className="flex flex-1 overflow-hidden">
            <aside className="hidden md:flex w-52 shrink-0 border-r bg-muted/30 flex-col">
              <div className="px-4 py-4 font-semibold text-lg border-b">LocalMind</div>
              <MainNav />
              <div className="mt-auto p-3 text-xs text-muted-foreground border-t">
                Press ⌘K for the command palette. Everything runs on your Mac.
              </div>
            </aside>
            <MobileNav />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
        <Toaster />
        <CommandPalette />
      </body>
    </html>
  );
}
