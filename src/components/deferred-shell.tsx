"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const CommandPalette = dynamic(
  () => import("@/components/command-palette").then((module) => module.CommandPalette),
  { ssr: false }
);
const EdgePulse = dynamic(
  () => import("@/components/edge-pulse").then((module) => module.EdgePulse),
  { ssr: false }
);
const OpenedTabRouter = dynamic(
  () => import("@/components/browse/opened-tab-router").then((module) => module.OpenedTabRouter),
  { ssr: false }
);
const ReportImprovement = dynamic(
  () => import("@/components/report-improvement").then((module) => module.ReportImprovement),
  { ssr: false }
);

/** Non-critical shell features — mount after first paint / idle. */
export function DeferredShell() {
  const [ready, setReady] = useState(false);
  const [decor, setDecor] = useState(false);

  useEffect(() => {
    // Critical: tab routing + ⌘K as soon as the browser is free.
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 1));
    const id = ric(() => setReady(true), { timeout: 400 });
    // Decorative pulse / report dialog: wait a beat so first clicks stay fast.
    const t = window.setTimeout(() => setDecor(true), 120);
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id as number);
      else clearTimeout(id as number);
      clearTimeout(t);
    };
  }, []);

  return (
    <>
      {ready && (
        <>
          <CommandPalette />
          <OpenedTabRouter />
        </>
      )}
      {decor && (
        <>
          <EdgePulse />
          <ReportImprovement />
        </>
      )}
    </>
  );
}
