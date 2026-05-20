import { NextResponse } from "next/server";
import os from "os";
import { execSync } from "child_process";

export const runtime = "nodejs";

function diskUsage(): { used: number; total: number } {
  try {
    const out = execSync("df -k / | tail -1", { encoding: "utf8" }).trim().split(/\s+/);
    const total = Number(out[1]) * 1024;
    const used = Number(out[2]) * 1024;
    return { used, total };
  } catch {
    return { used: 0, total: 0 };
  }
}

async function ollamaStatus(): Promise<string> {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    return r.ok ? "running" : "error";
  } catch {
    return "stopped";
  }
}

export async function GET() {
  const cpus = os.cpus();
  const loadPct = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = diskUsage();
  return NextResponse.json({
    cpu: loadPct,
    ram: { used: totalMem - freeMem, total: totalMem },
    disk,
    ollama: await ollamaStatus(),
    app: "running",
    timestamp: Date.now(),
  });
}
