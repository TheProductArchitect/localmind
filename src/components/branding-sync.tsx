"use client";

/**
 * Keeps the shell hyper-personalized:
 * - document.title = assistant_name
 * - Electron dock/window icon follows /api/pulse orb state
 * - Electron app/window title follows assistant_name
 *
 * No-ops the Electron IPC when running in a normal browser.
 */

import { useEffect, useRef } from "react";
import type { OrbState } from "@/components/orb";

type BrandingApi = {
  setBranding?: (patch: { name?: string; orbState?: string }) => Promise<unknown>;
};

function brandingApi(): BrandingApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { lmBrowser?: BrandingApi }).lmBrowser ?? null;
}

export function BrandingSync() {
  const lastName = useRef<string | null>(null);
  const lastState = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const [settingsRes, pulseRes] = await Promise.all([
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/pulse", { cache: "no-store" }),
        ]);
        if (!alive) return;
        const patch: { name?: string; orbState?: string } = {};
        if (settingsRes.ok) {
          const j = await settingsRes.json();
          const name = String(j?.settings?.assistant_name || "").trim();
          if (name && name !== lastName.current) {
            lastName.current = name;
            document.title = name;
            patch.name = name;
          } else if (name) {
            document.title = name;
          }
        }
        if (pulseRes.ok) {
          const p = await pulseRes.json();
          const state = (p?.state as OrbState) || "idle";
          if (state !== lastState.current) {
            lastState.current = state;
            patch.orbState = state;
          }
        }
        if ((patch.name || patch.orbState) && brandingApi()?.setBranding) {
          void brandingApi()!.setBranding!(patch);
        }
      } catch {
        /* offline / unauthenticated — ignore */
      }
    };

    void tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return null;
}

/** Call after Settings saves a new assistant_name for instant feedback. */
export function notifyAssistantName(name: string) {
  const n = name.trim();
  if (!n) return;
  document.title = n;
  const api = brandingApi();
  if (api?.setBranding) void api.setBranding({ name: n });
}
