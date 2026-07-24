import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Rail } from "@/components/rail";
import { EdgePulse } from "@/components/edge-pulse";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import { DiskBanner } from "@/components/disk-banner";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { FontScale } from "@/components/font-scale";
import { ConfirmProvider } from "@/components/confirm-dialog";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LocalMind",
  description: "A local-first AI control panel",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Phia, Grammarly, dark-
    // mode tools) inject attributes like data-phia-extension-fonts-loaded onto
    // <html>/<body> before React hydrates, which otherwise trips a hydration
    // mismatch warning. This suppresses that one-level attribute diff only.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans">
        <ConfirmProvider>
          <div className="flex flex-col h-screen overflow-hidden relative z-10">
            <DiskBanner />
            <div className="flex flex-1 overflow-hidden">
              <Rail />
              <SettingsSidebar />
              <main className="flex-1 min-h-0 overflow-auto relative pb-16 md:pb-0">{children}</main>
            </div>
          </div>
          <Toaster />
          <CommandPalette />
          <EdgePulse />
          <FontScale />
        </ConfirmProvider>
      </body>
    </html>
  );
}
