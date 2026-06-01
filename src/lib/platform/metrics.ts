import os from "os";
import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { PLATFORM } from "./index";

export type GPUInfo = {
  name: string;
  usagePct: number;
  vramUsed: number;
  vramTotal: number;
};

const isMac = PLATFORM === "macos-arm64" || PLATFORM === "macos-x86";
const isLinux = PLATFORM === "ubuntu" || PLATFORM === "debian" || PLATFORM === "wsl2";

// CPU — read /proc/stat twice on Linux for accurate %, fall back to loadavg on macOS.

async function getCPULinux(): Promise<number> {
  function read(): { total: number; idle: number } | null {
    try {
      const line = readFileSync("/proc/stat", "utf8").split("\n", 1)[0];
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0); // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);
      return { total, idle };
    } catch {
      return null;
    }
  }
  const a = read();
  if (!a) return 0;
  await new Promise((r) => setTimeout(r, 500));
  const b = read();
  if (!b) return 0;
  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
}

export async function getCPU(): Promise<number> {
  if (isLinux) return getCPULinux();
  // macOS: loadavg is a 1-min average — coarse but cheap and always available.
  const cpus = os.cpus().length || 1;
  return Math.min(100, Math.round((os.loadavg()[0] / cpus) * 100));
}

// Memory — /proc/meminfo on Linux is more accurate than os.freemem (which excludes cache).

export async function getMemory(): Promise<{ used: number; total: number }> {
  if (isLinux) {
    try {
      const txt = readFileSync("/proc/meminfo", "utf8");
      const lookup = (key: string): number => {
        const m = txt.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
        return m ? Number(m[1]) * 1024 : 0;
      };
      const total = lookup("MemTotal");
      const avail = lookup("MemAvailable") || lookup("MemFree");
      return { used: Math.max(0, total - avail), total };
    } catch {
      // fall through
    }
  }
  const total = os.totalmem();
  return { used: total - os.freemem(), total };
}

// Disk — df works on both macOS and Linux; same flags.

export async function getDisk(): Promise<{ used: number; total: number }> {
  try {
    const out = execSync("df -k / | tail -1", { encoding: "utf8" }).trim().split(/\s+/);
    return { total: Number(out[1]) * 1024, used: Number(out[2]) * 1024 };
  } catch {
    console.warn("[platform.metrics] disk usage unavailable");
    return { used: 0, total: 0 };
  }
}

// GPU — best-effort, returns null when no recognised GPU tooling is found.

function nvidiaSmi(): GPUInfo | null {
  const r = spawnSync(
    "nvidia-smi",
    ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
    { encoding: "utf8", timeout: 1500 }
  );
  if (r.status !== 0 || !r.stdout) return null;
  const line = r.stdout.trim().split("\n")[0];
  const [name, usage, used, total] = line.split(",").map((s) => s.trim());
  return {
    name,
    usagePct: Number(usage) || 0,
    vramUsed: (Number(used) || 0) * 1024 * 1024,
    vramTotal: (Number(total) || 0) * 1024 * 1024,
  };
}

function appleSiliconGPU(): GPUInfo | null {
  if (!(PLATFORM === "macos-arm64")) return null;
  // We can't get per-process GPU usage without sudo on macOS; return a placeholder
  // indicating presence so the dashboard can show "Apple Silicon GPU available".
  return { name: "Apple Silicon GPU", usagePct: 0, vramUsed: 0, vramTotal: 0 };
}

export async function getGPU(): Promise<GPUInfo | null> {
  try {
    if (isMac) return appleSiliconGPU();
    if (isLinux) {
      if (existsSync("/proc/driver/nvidia/version")) {
        const info = nvidiaSmi();
        if (info) return info;
      }
      // ROCm path could be added here when needed.
    }
  } catch (e) {
    console.warn("[platform.metrics] GPU probe failed", (e as Error).message);
  }
  return null;
}

// Convenience snapshot used by the System Dashboard.

export async function snapshot(): Promise<{
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  gpu: GPUInfo | null;
}> {
  const [cpu, ram, disk, gpu] = await Promise.all([getCPU(), getMemory(), getDisk(), getGPU()]);
  return { cpu, ram, disk, gpu };
}

// Used by index.ts for first-load GPU detection; exported so callers can also
// list discovered NVIDIA devices.
export function listNvidiaDevices(): string[] {
  try {
    return readdirSync("/proc/driver/nvidia/gpus");
  } catch {
    return [];
  }
}
