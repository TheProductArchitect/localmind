/**
 * Cached binary lookup.
 *
 * Resolving a tool used to shell out (`spawnSync("bash", ["-c", "command -v …"])`)
 * on every request. That blocks the event loop for the whole spawn — with the
 * chat stream and the 4s pulse poll sharing that loop, a handful of lookups is
 * enough to make the whole app feel frozen.
 *
 * Instead we walk PATH ourselves with async fs checks, and memoize: an
 * executable's location does not move while the server is up.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const cache = new Map<string, string | null>();

function candidates(cmd: string): string[] {
  // An explicit path is used as-is; PATH lookup only applies to bare names.
  if (cmd.includes("/")) return [cmd];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return dirs.map((d) => path.join(d, cmd));
}

/** Async, non-blocking, memoized. Prefer this in request handlers. */
export async function which(cmd: string): Promise<string | null> {
  if (!cmd) return null;
  const hit = cache.get(cmd);
  if (hit !== undefined) return hit;

  let found: string | null = null;
  for (const candidate of candidates(cmd)) {
    try {
      await fs.access(candidate, fsSync.constants.X_OK);
      found = candidate;
      break;
    } catch {
      /* next candidate */
    }
  }
  cache.set(cmd, found);
  return found;
}

/**
 * Synchronous variant for module-init and CLI paths. Still memoized and still
 * spawn-free, so a cache hit costs nothing.
 */
export function whichSync(cmd: string): string | null {
  if (!cmd) return null;
  const hit = cache.get(cmd);
  if (hit !== undefined) return hit;

  let found: string | null = null;
  for (const candidate of candidates(cmd)) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      found = candidate;
      break;
    } catch {
      /* next candidate */
    }
  }
  cache.set(cmd, found);
  return found;
}

/** Test seam — lets suites reset memoized lookups between cases. */
export function clearWhichCache(): void {
  cache.clear();
}
