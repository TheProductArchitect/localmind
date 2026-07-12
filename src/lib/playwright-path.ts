import fs from "fs";
import os from "os";
import path from "path";

/** Default Playwright browser cache for this OS (where `npx playwright install` puts files). */
export function defaultPlaywrightCache(): string {
  const home = os.homedir();
  return process.platform === "darwin"
    ? path.join(home, "Library", "Caches", "ms-playwright")
    : path.join(home, ".cache", "ms-playwright");
}

function hasChromiumTree(browsersPath: string): boolean {
  try {
    if (!fs.existsSync(browsersPath)) return false;
    for (const name of fs.readdirSync(browsersPath)) {
      if (name.startsWith("chromium_headless_shell-")) {
        const root = path.join(browsersPath, name);
        for (const sub of fs.readdirSync(root)) {
          const shell = path.join(root, sub, "chrome-headless-shell");
          if (fs.existsSync(shell)) return true;
          const linux = path.join(root, sub, "headless_shell");
          if (fs.existsSync(linux)) return true;
        }
        if (fs.existsSync(path.join(root, "chrome-headless-shell"))) return true;
      }
      if (/^chromium-\d+$/.test(name)) {
        const root = path.join(browsersPath, name);
        if (fs.existsSync(path.join(root, "chrome-mac-arm64"))) return true;
        if (fs.existsSync(path.join(root, "chrome-linux"))) return true;
        if (fs.existsSync(path.join(root, "chrome-win"))) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Cursor (and some sandboxes) inject PLAYWRIGHT_BROWSERS_PATH into a temp dir
 * that lacks chromium_headless_shell even after `npx playwright install` in the
 * project. Prefer the user's real cache when the injected path is incomplete.
 */
export function resolvePlaywrightBrowsersPath(): string | undefined {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  const fallback = defaultPlaywrightCache();

  if (!current) return undefined;
  if (hasChromiumTree(current)) return current;
  if (hasChromiumTree(fallback)) return fallback;
  return current;
}

/** Run fn with PLAYWRIGHT_BROWSERS_PATH corrected for LocalMind's Playwright use. */
export async function withPlaywrightBrowsersPath<T>(fn: () => Promise<T>): Promise<T> {
  const resolved = resolvePlaywrightBrowsersPath();
  const prev = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (resolved === undefined) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  } else {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  }
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = prev;
  }
}

/** Call once at process start before Playwright is imported anywhere. */
export function applyPlaywrightBrowsersPathFix(): void {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (!current) return;
  const resolved = resolvePlaywrightBrowsersPath();
  if (resolved && resolved !== current) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  }
}

applyPlaywrightBrowsersPathFix();
