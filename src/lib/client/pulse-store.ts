/**
 * Single shared /api/pulse poller for Rail + BrandingSync.
 * Avoids duplicate 2.5s + 4s polls fighting for the event loop.
 */

import type { OrbState } from "@/components/orb";

export type Pulse = {
  state: OrbState;
  processes: number;
  graphs: number;
  subagents: number;
  suspended: boolean;
};

const INTERVAL_MS = 4_000;
const DEFAULT: Pulse = {
  state: "idle",
  processes: 0,
  graphs: 0,
  subagents: 0,
  suspended: false,
};

let last: Pulse = DEFAULT;
const listeners = new Set<(p: Pulse) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function publish(p: Pulse) {
  last = p;
  for (const cb of listeners) {
    try {
      cb(p);
    } catch {
      /* ignore */
    }
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const r = await fetch("/api/pulse", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as Pulse;
    if (
      j.state === last.state &&
      j.processes === last.processes &&
      j.graphs === last.graphs &&
      j.subagents === last.subagents &&
      j.suspended === last.suspended
    ) {
      return;
    }
    publish(j);
  } catch {
    /* offline */
  } finally {
    ticking = false;
  }
}

function ensurePolling() {
  if (timer != null) return;
  void tick();
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

function stopIfIdle() {
  if (listeners.size === 0 && timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export function getPulse(): Pulse {
  return last;
}

export function subscribePulse(cb: (p: Pulse) => void): () => void {
  listeners.add(cb);
  cb(last);
  ensurePolling();
  return () => {
    listeners.delete(cb);
    stopIfIdle();
  };
}
