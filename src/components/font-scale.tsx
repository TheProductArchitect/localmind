"use client";

import { useEffect } from "react";

/**
 * Applies Settings → font size as the document root rem scale.
 * Default 17px (above the browser's usual 16) so the whole UI reads larger;
 * clamp keeps Tailwind rem layouts from exploding.
 */
export function FontScale() {
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.settings) return;
        const n = Number(j.settings.chat_font_size);
        const px = Number.isFinite(n) ? Math.min(28, Math.max(12, n)) : 17;
        document.documentElement.style.setProperty("--lm-root-fs", `${px}px`);
      })
      .catch(() => {
        document.documentElement.style.setProperty("--lm-root-fs", "17px");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
