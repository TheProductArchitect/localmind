import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";

export type Platform =
  | "macos-arm64"
  | "macos-x86"
  | "ubuntu"
  | "debian"
  | "wsl2"
  | "unknown";

export type PlatformCaps = {
  hasAppleScript: boolean;
  hasSystemd: boolean;
  hasNotifySend: boolean;
  hasWinNotification: boolean;
  hasNativeNotification: boolean;
  isWSL: boolean;
  hasGPU: boolean;
};

function readEtcOsRelease(): Record<string, string> {
  if (!existsSync("/etc/os-release")) return {};
  const txt = readFileSync("/etc/os-release", "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

function detectIsWSL(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const v = readFileSync("/proc/version", "utf8").toLowerCase();
    return v.includes("microsoft") || v.includes("wsl");
  } catch {
    return false;
  }
}

function detectPlatform(): Platform {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "macos-arm64" : "macos-x86";
  }
  if (process.platform === "linux") {
    if (detectIsWSL()) return "wsl2";
    const rel = readEtcOsRelease();
    const id = (rel.ID || "").toLowerCase();
    const idLike = (rel.ID_LIKE || "").toLowerCase();
    if (id === "ubuntu" || idLike.includes("ubuntu")) return "ubuntu";
    if (id === "debian" || idLike.includes("debian")) return "debian";
  }
  return "unknown";
}

function hasCommand(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function detectGPU(): boolean {
  // Best-effort check at module load. metrics.getGPU() does the real work.
  if (process.platform === "darwin") {
    // Apple Silicon always has an integrated GPU usable by Metal.
    return process.arch === "arm64";
  }
  if (process.platform === "linux") {
    if (existsSync("/proc/driver/nvidia/version")) return true;
    if (hasCommand("rocm-smi")) return true;
    if (hasCommand("nvidia-smi")) return true;
  }
  return false;
}

export const PLATFORM: Platform = detectPlatform();

export const PLATFORM_CAPS: PlatformCaps = {
  hasAppleScript: PLATFORM === "macos-arm64" || PLATFORM === "macos-x86",
  hasSystemd: PLATFORM === "ubuntu" || PLATFORM === "debian",
  hasNotifySend: process.platform === "linux" && hasCommand("notify-send"),
  hasWinNotification: PLATFORM === "wsl2",
  hasNativeNotification: PLATFORM === "macos-arm64" || PLATFORM === "macos-x86",
  isWSL: PLATFORM === "wsl2",
  hasGPU: detectGPU(),
};

export function describePlatform(): string {
  switch (PLATFORM) {
    case "macos-arm64": return "macOS (Apple Silicon)";
    case "macos-x86": return "macOS (Intel)";
    case "ubuntu": return "Ubuntu";
    case "debian": return "Debian";
    case "wsl2": return "Windows (WSL2)";
    default: return "Unknown platform";
  }
}

// Silence unused-import linter when running on platforms that don't use these.
void spawnSync;
