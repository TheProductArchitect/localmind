"use client";

/**
 * Keeps the shell hyper-personalized:
 * - document.title = assistant_name
 * - Electron dock/window icon follows /api/pulse orb state
 * - Electron app/window title follows assistant_name
 *
 * Settings are read once via the shared cache (not polled).
 * Pulse uses the shared store so Rail doesn't double-fetch.
 */

import { useEffect, useRef } from "react";
import type { OrbState } from "@/components/orb";
import { fetchSettings, patchSettingsCache, subscribeSettings } from "@/lib/client/settings-cache";
import { subscribePulse } from "@/lib/client/pulse-store";

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
    const applyName = (name: string) => {
      const n = name.trim();
      if (!n) return;
      document.title = n;
      if (n !== lastName.current) {
        lastName.current = n;
        const api = brandingApi();
        if (api?.setBranding) void api.setBranding({ name: n });
      } else {
        document.title = n;
      }
    };

    const unsubSettings = subscribeSettings((s) => {
      const name = String(s?.assistant_name || "").trim();
      if (name) applyName(name);
    });
    void fetchSettings().catch(() => { /* offline */ });

    const unsubPulse = subscribePulse((p) => {
      const state = (p?.state as OrbState) || "idle";
      if (state === lastState.current) return;
      lastState.current = state;
      const api = brandingApi();
      if (api?.setBranding) void api.setBranding({ orbState: state });
    });

    return () => {
      unsubSettings();
      unsubPulse();
    };
  }, []);

  return null;
}

/** Call after Settings saves a new assistant_name for instant feedback. */
export function notifyAssistantName(name: string) {
  const n = name.trim();
  if (!n) return;
  patchSettingsCache({ assistant_name: n });
  document.title = n;
  const api = brandingApi();
  if (api?.setBranding) void api.setBranding({ name: n });
}
