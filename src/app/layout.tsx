import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MainNav } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import { DiskBanner } from "@/components/disk-banner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <div className="flex flex-col h-screen overflow-hidden">
          <DiskBanner />
          <div className="flex flex-1 overflow-hidden">
            <aside className="hidden md:flex w-60 shrink-0 border-r border-border/70 bg-card/60 backdrop-blur-sm flex-col">
              <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft">
                  <span className="text-sm font-bold tracking-tight">LM</span>
                </div>
                <div className="flex flex-col leading-none">
                  <span className="font-semibold tracking-tight">LocalMind</span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">Local-first AI</span>
                </div>
              </div>
              <MainNav />
              <div className="mt-auto px-4 py-3.5 text-[11px] leading-relaxed text-muted-foreground border-t border-border/70">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
                  ⌘K
                </kbd>{" "}
                for the command palette. Everything runs on your Mac.
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
