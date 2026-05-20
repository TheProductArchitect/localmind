import { spawn, execFile, type ChildProcess } from "child_process";
import { logger } from "../logger";

let tunnelProc: ChildProcess | null = null;
let tunnelUrl: string | null = null;

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

// Starts a Cloudflare tunnel to localhost:3000 and captures the public URL.
export async function startTunnel(): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (tunnelUrl && tunnelProc && !tunnelProc.killed) return { ok: true, url: tunnelUrl };

  // Ensure cloudflared is installed.
  const haveCloudflared = await new Promise<boolean>((resolve) => {
    execFile("which", ["cloudflared"], (err) => resolve(!err));
  });
  if (!haveCloudflared) {
    const installed = await new Promise<boolean>((resolve) => {
      execFile("brew", ["install", "cloudflare/cloudflare/cloudflared"], { timeout: 180000 }, (err) =>
        resolve(!err)
      );
    });
    if (!installed) return { ok: false, error: "cloudflared is not installed and Homebrew install failed." };
  }

  return new Promise((resolve) => {
    tunnelProc = spawn("cloudflared", ["tunnel", "--url", "http://localhost:3000"]);
    let settled = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !settled) {
        settled = true;
        tunnelUrl = m[0];
        logger.info("cloudflare tunnel started", { url: tunnelUrl });
        resolve({ ok: true, url: tunnelUrl });
      }
    };
    tunnelProc.stdout?.on("data", onData);
    tunnelProc.stderr?.on("data", onData); // cloudflared prints the URL to stderr
    tunnelProc.on("exit", () => { tunnelUrl = null; tunnelProc = null; });
    setTimeout(() => {
      if (!settled) { settled = true; resolve({ ok: false, error: "Tunnel did not start within 30 seconds." }); }
    }, 30000);
  });
}

export function stopTunnel() {
  try { tunnelProc?.kill(); } catch {}
  tunnelProc = null;
  tunnelUrl = null;
}
