import { NextResponse } from "next/server";
import os from "os";
import { statfs } from "node:fs/promises";

export const runtime = "nodejs";

// Health is polled every 2s by the System page and every 60s by the disk
// banner. Both used to pay for a `df` subprocess and a 1.5s Ollama probe on
// every call, and `execSync` blocked the event loop for the whole spawn —
// which is what stalled the chat stream and the pulse poll. Serve a short
// TTL snapshot instead so N concurrent pollers cost one refresh.
const TTL_MS = 2_000;

type Health = {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  ollama: string;
  app: string;
  timestamp: number;
};

let cached: { at: number; value: Health } | null = null;
let inFlight: Promise<Health> | null = null;

async function diskUsage(): Promise<{ used: number; total: number }> {
  try {
    const s = await statfs("/");
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    return { used: total - free, total };
  } catch {
    return { used: 0, total: 0 };
  }
}

async function ollamaStatus(): Promise<string> {
  // Hit the real `/api/tags` endpoint and verify the response shape (a
  // `models` array). A port that responds but isn't ollama — a stale proxy,
  // an HTTP error body, an upgraded WebSocket — should read as stopped.
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return "stopped";
    const j = (await r.json().catch(() => null)) as { models?: unknown } | null;
    if (j && Array.isArray(j.models)) return "running";
    return "stopped";
  } catch {
    return "stopped";
  }
}

async function collect(): Promise<Health> {
  const cpus = os.cpus();
  const loadPct = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const [disk, ollama] = await Promise.all([diskUsage(), ollamaStatus()]);
  return {
    cpu: loadPct,
    ram: { used: totalMem - freeMem, total: totalMem },
    disk,
    ollama,
    app: "running",
    timestamp: Date.now(),
  };
}

async function snapshot(): Promise<Health> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  // Collapse concurrent pollers onto one refresh.
  if (inFlight) return inFlight;
  inFlight = collect()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function GET() {
  return NextResponse.json(await snapshot());
}
