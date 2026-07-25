"use client";

import dynamic from "next/dynamic";

const CommandPalette = dynamic(
  () => import("@/components/command-palette").then((module) => module.CommandPalette),
  { ssr: false }
);
const EdgePulse = dynamic(
  () => import("@/components/edge-pulse").then((module) => module.EdgePulse),
  { ssr: false }
);

/** Non-critical shell features loaded after the core layout hydrates. */
export function DeferredShell() {
  return (
    <>
      <CommandPalette />
      <EdgePulse />
    </>
  );
}
