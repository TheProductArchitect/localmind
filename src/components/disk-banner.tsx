"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export function DiskBanner() {
  const [low, setLow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch("/api/system/health");
        const j = await r.json();
        const freeGB = (j.disk.total - j.disk.used) / 1e9;
        if (!cancelled) setLow(freeGB < 5);
      } catch {}
    };
    // Defer so chat chrome + settings win the first paint window.
    const start = window.setTimeout(() => {
      void check();
    }, 8_000);
    const t = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      clearInterval(t);
    };
  }, []);

  if (!low) return null;
  return (
    <div className="bg-amber-500 text-white text-sm px-4 py-1.5 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" />
      Low disk space — less than 5 GB free. Free up space to keep models and backups working.
    </div>
  );
}
