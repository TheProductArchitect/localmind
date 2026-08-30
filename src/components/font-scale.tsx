"use client";

import { useEffect } from "react";
import { fetchSettings, subscribeSettings } from "@/lib/client/settings-cache";

/**
 * Applies Settings → font size as the document root rem scale.
 * Default 17px (above the browser's usual 16) so the whole UI reads larger;
 * clamp keeps Tailwind rem layouts from exploding.
 */
function applyFont(n: unknown) {
  const px = Number.isFinite(Number(n)) ? Math.min(28, Math.max(12, Number(n))) : 17;
  document.documentElement.style.setProperty("--lm-root-fs", `${px}px`);
}

export function FontScale() {
  useEffect(() => {
    const unsub = subscribeSettings((s) => applyFont(s.chat_font_size));
    void fetchSettings()
      .then((s) => applyFont(s.chat_font_size))
      .catch(() => applyFont(17));
    return unsub;
  }, []);

  return null;
}
