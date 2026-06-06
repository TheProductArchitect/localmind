/**
 * GET /api/integrations — list every open-source piece LocalMind builds on,
 * plus the npm-side version + outdated status for each library.
 *
 * Two sources of truth:
 *
 *   1. CURATED — a hand-maintained list of high-signal integrations
 *      (Ollama, whisper.cpp, ffmpeg, sqlite-vec, pi-coding-agent, n8n MCP,
 *      Penpot MCP, Playwright Chromium, etc.) that live OUTSIDE
 *      package.json — installed by the install script, or system tools.
 *      For each, we describe what it does and check basic presence via
 *      `which` / `command -v`.
 *
 *   2. NPM — the actual dependency tree. We read package.json directly to
 *      list installed versions, and (when `?check=1`) run `npm outdated`
 *      to surface what could be upgraded. We never run `npm install` —
 *      the user does that themselves after reviewing.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
export const runtime = "nodejs";

type OssEntry = {
  name: string;
  purpose: string;
  license: string;
  repo: string;
  source: "system" | "npm";
  version?: string;
  detected?: boolean;
  /** For npm-source items, the latest semver available (if checked). */
  latest?: string;
  /** True if `version` and `latest` differ. */
  outdated?: boolean;
};

const CURATED: Omit<OssEntry, "version" | "detected" | "latest" | "outdated">[] = [
  // Core local LLM runtime
  { name: "Ollama",           purpose: "Local LLM runtime (loads + serves models).",                 license: "MIT",        repo: "https://github.com/ollama/ollama",        source: "system" },
  // Voice
  { name: "whisper.cpp",      purpose: "Local press-to-talk + streaming speech-to-text.",            license: "MIT",        repo: "https://github.com/ggerganov/whisper.cpp", source: "system" },
  { name: "openai-whisper",   purpose: "Batch (GPU-aware) transcription for long-form audio.",       license: "MIT",        repo: "https://github.com/openai/whisper",        source: "system" },
  { name: "ffmpeg",           purpose: "Audio conversion + voice-activity detection for STT.",       license: "LGPL-2.1+",  repo: "https://github.com/FFmpeg/FFmpeg",         source: "system" },
  // Storage + retrieval
  { name: "SQLite",           purpose: "Embedded relational store (config + conversations + knowledge).", license: "Public domain", repo: "https://github.com/sqlite/sqlite", source: "system" },
  { name: "sqlite-vec",       purpose: "Vector search extension for SQLite (semantic search).",      license: "Apache-2.0", repo: "https://github.com/asg017/sqlite-vec",     source: "system" },
  // Coding agent
  { name: "pi-coding-agent",  purpose: "Specialist coding agent Sora delegates large refactors to.", license: "MIT",        repo: "https://pi.dev",                            source: "system" },
  // Browser automation
  { name: "Playwright",       purpose: "Chromium driver for the browser tool.",                       license: "Apache-2.0", repo: "https://github.com/microsoft/playwright",  source: "system" },
  // MCP servers Sora can plug into
  { name: "n8n",              purpose: "Visual workflow engine for non-LLM automations.",             license: "Apache-2.0 w/ Commons Clause", repo: "https://github.com/n8n-io/n8n", source: "system" },
  { name: "Home Assistant",   purpose: "Home automation hub Sora can read/control via MCP.",          license: "Apache-2.0", repo: "https://github.com/home-assistant/core",   source: "system" },
];

async function whichBinary(name: string): Promise<boolean> {
  try {
    await exec("/usr/bin/env", ["bash", "-c", `command -v ${name}`]);
    return true;
  } catch { return false; }
}

async function ollamaVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("ollama", ["--version"], { timeout: 3000 });
    return stdout.trim().replace(/^ollama version /i, "") || undefined;
  } catch { return undefined; }
}

async function ffmpegVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("ffmpeg", ["-version"], { timeout: 3000 });
    const m = stdout.match(/ffmpeg version (\S+)/);
    return m ? m[1] : undefined;
  } catch { return undefined; }
}

async function detectSystemEntry(name: string): Promise<{ detected: boolean; version?: string }> {
  switch (name) {
    case "Ollama":          return { detected: await whichBinary("ollama"),       version: await ollamaVersion() };
    case "whisper.cpp":     return { detected: await whichBinary("whisper-cli") };
    case "openai-whisper":  return { detected: await whichBinary("whisper") };
    case "ffmpeg":          return { detected: await whichBinary("ffmpeg"),       version: await ffmpegVersion() };
    case "SQLite":          return { detected: true }; // Always present via better-sqlite3 native bindings
    case "sqlite-vec":      return { detected: true }; // JS fallback always works, native is optional
    case "pi-coding-agent": return { detected: await whichBinary("pi") };
    case "Playwright":      return { detected: await whichBinary("npx") };
    case "n8n":             return { detected: await whichBinary("n8n") };
    case "Home Assistant":  return { detected: false }; // External service, not local binary
    default:                return { detected: false };
  }
}

// Curated npm libraries to surface as integrations. The full dep tree is
// long; we highlight the load-bearing ones so the user can see what they're
// running without scrolling 100+ items.
const HIGHLIGHTED_NPM = [
  { dep: "next",                         purpose: "App framework (App Router + RSC).",                  license: "MIT",        repo: "https://github.com/vercel/next.js" },
  { dep: "react",                        purpose: "UI library.",                                         license: "MIT",        repo: "https://github.com/facebook/react" },
  { dep: "@anthropic-ai/sdk",            purpose: "Anthropic API client (optional cloud fallback).",     license: "MIT",        repo: "https://github.com/anthropics/anthropic-sdk-typescript" },
  { dep: "@modelcontextprotocol/sdk",    purpose: "MCP client — connect external tool servers.",        license: "MIT",        repo: "https://github.com/modelcontextprotocol/typescript-sdk" },
  { dep: "better-sqlite3",               purpose: "Native SQLite binding — synchronous, fast.",          license: "MIT",        repo: "https://github.com/WiseLibs/better-sqlite3" },
  { dep: "@simplewebauthn/browser",      purpose: "Passkey registration / login on the web side.",       license: "MIT",        repo: "https://github.com/MasterKale/SimpleWebAuthn" },
  { dep: "playwright",                   purpose: "Browser automation (driver + APIs).",                 license: "Apache-2.0", repo: "https://github.com/microsoft/playwright" },
  { dep: "react-markdown",               purpose: "Render assistant markdown safely in chat.",           license: "MIT",        repo: "https://github.com/remarkjs/react-markdown" },
  { dep: "remark-gfm",                   purpose: "GitHub-flavoured markdown extensions.",               license: "MIT",        repo: "https://github.com/remarkjs/remark-gfm" },
  { dep: "lucide-react",                 purpose: "Icon set used across the v2 UI.",                     license: "ISC",        repo: "https://github.com/lucide-icons/lucide" },
  { dep: "tailwindcss",                  purpose: "Utility CSS framework.",                              license: "MIT",        repo: "https://github.com/tailwindlabs/tailwindcss" },
  { dep: "zod",                          purpose: "Schema validation at API boundaries.",                license: "MIT",        repo: "https://github.com/colinhacks/zod" },
];

type Outdated = Record<string, { current: string; latest: string }>;

async function readPackageJsonVersions(): Promise<Record<string, string>> {
  const pkgPath = path.join(process.cwd(), "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    const j = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return j.dependencies ?? {};
  } catch { return {}; }
}

async function readInstalledVersion(dep: string): Promise<string | undefined> {
  try {
    const p = path.join(process.cwd(), "node_modules", dep, "package.json");
    const raw = await fs.readFile(p, "utf8");
    return (JSON.parse(raw).version as string) || undefined;
  } catch { return undefined; }
}

async function runNpmOutdated(): Promise<Outdated> {
  try {
    // `npm outdated --json` returns non-zero exit code when outdated items
    // exist. We swallow the exit and parse stdout anyway.
    const { stdout } = await exec("npm", ["outdated", "--json"], {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout || "{}") as Outdated;
  } catch (e) {
    // npm outdated exits 1 when there ARE outdated packages. Extract stdout.
    const stdout = (e as { stdout?: string }).stdout || "";
    try { return JSON.parse(stdout || "{}") as Outdated; }
    catch { return {}; }
  }
}

export async function GET(req: NextRequest) {
  const check = req.nextUrl.searchParams.get("check") === "1";

  // System tools — parallel detect.
  const systemPromises = CURATED.map(async (c) => {
    const det = await detectSystemEntry(c.name);
    return { ...c, version: det.version, detected: det.detected } as OssEntry;
  });

  // NPM tools — read installed versions + optionally check outdated.
  const declared = await readPackageJsonVersions();
  const outdated = check ? await runNpmOutdated() : {};
  const npmPromises = HIGHLIGHTED_NPM.map(async (n) => {
    const installed = await readInstalledVersion(n.dep);
    const declaredRange = declared[n.dep];
    const o = outdated[n.dep];
    const entry: OssEntry = {
      name: n.dep,
      purpose: n.purpose,
      license: n.license,
      repo: n.repo,
      source: "npm",
      version: installed || declaredRange,
      detected: !!installed,
      latest: o?.latest,
      outdated: !!o && !!installed && o.latest !== installed,
    };
    return entry;
  });

  const [system, npm] = await Promise.all([
    Promise.all(systemPromises),
    Promise.all(npmPromises),
  ]);

  const outdatedCount = npm.filter((n) => n.outdated).length;
  return NextResponse.json({
    system,
    npm,
    summary: {
      total: system.length + npm.length,
      detected: system.filter((s) => s.detected).length + npm.filter((s) => s.detected).length,
      outdated_count: outdatedCount,
      checked_for_updates: check,
      checked_at: check ? Date.now() : null,
    },
  });
}
