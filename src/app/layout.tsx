import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Rail } from "@/components/rail";
import { EdgePulse } from "@/components/edge-pulse";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import { DiskBanner } from "@/components/disk-banner";
import { SettingsSidebar } from "@/components/settings-sidebar";

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
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <div className="flex flex-col h-screen overflow-hidden relative z-10">
          <DiskBanner />
          <div className="flex flex-1 overflow-hidden">
            <Rail />
            <SettingsSidebar />
            <main className="flex-1 overflow-auto relative pb-16 md:pb-0">{children}</main>
          </div>
        </div>
        <Toaster />
        <CommandPalette />
        <EdgePulse />
      </body>
    </html>
  );
}
