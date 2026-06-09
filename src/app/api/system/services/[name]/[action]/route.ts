/**
 * Service controller for `localmind` and `ollama`.
 *
 * Both services can be running under any of a few process-supervision
 * regimes — pm2 in production, npm/next-dev for development, or a bare
 * `ollama serve` started by the install script. We try each strategy in
 * order and surface a clear status to the caller.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile, exec as execCb } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/logger";

const exec = promisify(execFile);
const shell = promisify(execCb);
export const runtime = "nodejs";

const VALID_SERVICES = ["ollama", "localmind"] as const;
const VALID_ACTIONS = ["start", "stop", "restart"] as const;

type Result = { ok: boolean; via: string; detail?: string };

async function trySh(label: string, cmd: string, args: string[]): Promise<Result> {
  try {
    await exec(cmd, args, { timeout: 20_000 });
    return { ok: true, via: label };
  } catch (e) {
    return { ok: false, via: label, detail: (e as Error).message };
  }
}

async function tryShell(label: string, cmd: string): Promise<Result> {
  try {
    await shell(cmd, { timeout: 20_000 });
    return { ok: true, via: label };
  } catch (e) {
    return { ok: false, via: label, detail: (e as Error).message };
  }
}

async function ollamaRunning(): Promise<boolean> {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return false;
    const j = (await r.json().catch(() => null)) as { models?: unknown } | null;
    return !!(j && Array.isArray(j.models));
  } catch {
    return false;
  }
}

async function stopOllama(): Promise<Result> {
  // 1) Homebrew services (mac)
  let r = await trySh("brew", "brew", ["services", "stop", "ollama"]);
  if (r.ok && !(await ollamaRunning())) return r;
  // 2) Generic pkill (matches process whose argv contains "ollama serve")
  r = await trySh("pkill -f", "pkill", ["-f", "ollama serve"]);
  if (r.ok && !(await ollamaRunning())) return r;
  // 3) Exact-name pkill (matches /usr/local/bin/ollama on its own)
  r = await trySh("pkill -x", "pkill", ["-x", "ollama"]);
  if (r.ok && !(await ollamaRunning())) return r;
  // 4) systemctl (linux)
  r = await trySh("systemctl --user", "systemctl", ["--user", "stop", "ollama"]);
  if (r.ok && !(await ollamaRunning())) return r;
  // Final check — maybe one of the kills actually worked even if its exit
  // status was non-zero (no matching processes).
  if (!(await ollamaRunning())) return { ok: true, via: "already stopped" };
  return { ok: false, via: "all strategies", detail: "Ollama is still responding on :11434 after every shutdown attempt." };
}

async function startOllama(): Promise<Result> {
  // 1) Homebrew services
  let r = await trySh("brew", "brew", ["services", "start", "ollama"]);
  if (r.ok) {
    // Wait briefly for the daemon to come up.
    for (let i = 0; i < 20; i++) {
      if (await ollamaRunning()) return r;
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  // 2) Bare background spawn — works on any platform that has ollama on PATH
  r = await tryShell("background spawn", "nohup ollama serve >/tmp/ollama.log 2>&1 &");
  if (r.ok) {
    for (let i = 0; i < 20; i++) {
      if (await ollamaRunning()) return r;
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  return { ok: false, via: "all strategies", detail: "Could not bring Ollama up on :11434. Try running `ollama serve` manually." };
}

async function stopLocalmind(): Promise<Result> {
  // pm2 path (install script registers LocalMind under pm2)
  const r = await trySh("pm2", "pm2", ["stop", "localmind"]);
  if (r.ok) return r;
  // launchctl path (macOS install registers a launch agent)
  const r2 = await tryShell("launchctl", `launchctl unload ~/Library/LaunchAgents/com.localmind.plist 2>/dev/null`);
  if (r2.ok) return r2;
  return {
    ok: false,
    via: "all strategies",
    detail:
      "LocalMind is running outside any process supervisor we can control (likely `npm run dev` or `next dev`). Stop it in the terminal that started it.",
  };
}

async function startLocalmind(): Promise<Result> {
  const r = await trySh("pm2", "pm2", ["start", "localmind"]);
  if (r.ok) return r;
  const r2 = await tryShell("launchctl", `launchctl load ~/Library/LaunchAgents/com.localmind.plist 2>/dev/null`);
  if (r2.ok) return r2;
  return {
    ok: false,
    via: "all strategies",
    detail: "LocalMind isn't registered with any supervisor we can start. Run `npm run dev` or re-run `install.sh`.",
  };
}

export async function POST(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ name: string; action: string }> }) {
  const params = await paramsPromise;
  const name = params.name as (typeof VALID_SERVICES)[number];
  const action = params.action as (typeof VALID_ACTIONS)[number];
  if (!(VALID_SERVICES as readonly string[]).includes(name) || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Unknown service or action" }, { status: 400 });
  }
  logger.info(`service ${action} requested`, { service: name });

  let result: Result;
  if (name === "ollama") {
    if (action === "stop")        result = await stopOllama();
    else if (action === "start")  result = await startOllama();
    else                          { await stopOllama(); result = await startOllama(); }
  } else {
    if (action === "stop")        result = await stopLocalmind();
    else if (action === "start")  result = await startLocalmind();
    else                          { await stopLocalmind(); result = await startLocalmind(); }
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.detail || `Could not ${action} ${name}.`, via: result.via },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, via: result.via });
}
