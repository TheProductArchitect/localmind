/**
 * Built-in MCP servers — the ones LocalMind ships natively.
 *
 * These are NOT the same as user-installed servers:
 *   - they're seeded on every boot so users don't have to install them
 *   - they can be toggled (enabled=0) but not deleted
 *   - their command path is resolved against the running install root, not
 *     stored in the migration, so a moved install still works
 *
 * To add a new builtin: append to `BUILTIN_MCP_SERVERS`, give it a stable id,
 * point `relativeLauncher` at a script inside the repo, and add a short note
 * to the README. The seeder is idempotent — duplicate boots are fine.
 */

import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import type Database from "better-sqlite3";

export type BuiltinSpec = {
  /** Stable PK. Must start with `builtin-`. */
  id: string;
  name: string;
  description: string;
  /** Path to the launcher, relative to the repo root. */
  relativeLauncher: string;
  /** Default tier for tools discovered on this server. */
  defaultToolTier: "allow" | "ask" | "pin";
  /**
   * Optional bootstrap script (relative to repo root). If present and not
   * yet completed (sentinel file missing), the server stays disabled and
   * the UI prompts the user to run it. Keeps slow first-run installs out
   * of the MCP spawn path, which would otherwise be killed by the
   * outbound proxy and surface as "Connection closed".
   */
  relativeBootstrap?: string;
  /** Path to a file whose existence proves bootstrap finished. */
  relativeBootstrapSentinel?: string;
};

export const BUILTIN_MCP_SERVERS: BuiltinSpec[] = [
  {
    id: "builtin-secure-browser",
    name: "Secure Browser",
    description:
      "Fetch a URL, strip scripts/hidden nodes, convert to Markdown, and scan for prompt injection before returning content to the model. Single tool: read_secure_webpage.",
    relativeLauncher: "mcp-servers/secure-browser/run.sh",
    relativeBootstrap: "mcp-servers/secure-browser/bootstrap.sh",
    // The launcher refuses to start without the venv's MCP entrypoint, so
    // its existence is a tight proof that bootstrap.sh ran successfully.
    relativeBootstrapSentinel: "mcp-servers/secure-browser/.venv/bin/secure-browser-mcp",
    defaultToolTier: "allow",
  },
];

export function isBuiltinBootstrapped(spec: BuiltinSpec): boolean {
  if (!spec.relativeBootstrapSentinel) return true;
  return fs.existsSync(path.resolve(process.cwd(), spec.relativeBootstrapSentinel));
}

// Module-level state for the auto-bootstrap watcher. Status is read by the
// /api/mcp/servers GET so the UI can show a "first-run install in progress"
// banner even on pages that didn't kick off the install themselves.
export type AutoBootstrapStatus = {
  state: "idle" | "running" | "done" | "failed";
  log: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

const autoStatus = new Map<string, AutoBootstrapStatus>();
const autoStarted = new Set<string>();

export function getAutoBootstrapStatus(id: string): AutoBootstrapStatus {
  return autoStatus.get(id) || { state: "idle", log: "" };
}

/**
 * First-run UX: any built-in that needs bootstrap gets its install kicked
 * off automatically the very first time the config DB initialises. The
 * spawn happens with the MCP outbound proxy env vars stripped, so pip and
 * playwright can reach the public internet.
 *
 * Fire-and-forget — boot is never blocked on the install. Progress is
 * tracked in `autoStatus` so the MCP page can surface it without the user
 * needing to click anything.
 *
 * Guard: only fires once per process, per builtin. If the user manually
 * triggers the bootstrap endpoint in parallel, both will write to the same
 * sentinel; the late winner is harmless (everything is idempotent).
 */
export function autoBootstrapBuiltinsInBackground(): void {
  for (const spec of BUILTIN_MCP_SERVERS) {
    if (!spec.relativeBootstrap) continue;
    if (isBuiltinBootstrapped(spec)) continue;
    if (autoStarted.has(spec.id)) continue;
    const script = path.resolve(process.cwd(), spec.relativeBootstrap);
    if (!fs.existsSync(script)) continue;
    autoStarted.add(spec.id);

    const status: AutoBootstrapStatus = { state: "running", log: "", startedAt: Date.now() };
    autoStatus.set(spec.id, status);

    const child = spawn("bash", [script], {
      cwd: path.dirname(script),
      // Strip the MCP outbound proxy: pip + playwright need direct internet.
      env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onChunk = (d: Buffer) => {
      status.log += d.toString();
      // Cap the buffered log so a chatty pip install doesn't balloon memory.
      if (status.log.length > 64_000) status.log = status.log.slice(-64_000);
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("close", (code) => {
      status.finishedAt = Date.now();
      if (code === 0 && isBuiltinBootstrapped(spec)) {
        status.state = "done";
      } else {
        status.state = "failed";
        status.error = `bootstrap exited ${code}`;
      }
    });
    child.on("error", (e) => {
      status.state = "failed";
      status.error = e.message;
      status.finishedAt = Date.now();
    });
  }
}

function resolveLauncher(rel: string): string | null {
  const abs = path.resolve(process.cwd(), rel);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Insert any missing builtin rows and refresh their metadata to match the
 * current `BUILTIN_MCP_SERVERS` table. Called from `getConfigDb()` after
 * migrations run, so every boot gets the latest description / launcher path.
 */
export function ensureBuiltinMcpServers(db: Database.Database): void {
  const now = Date.now();
  for (const spec of BUILTIN_MCP_SERVERS) {
    const launcher = resolveLauncher(spec.relativeLauncher);
    if (!launcher) {
      // The bundled directory wasn't found at this install location. Skip
      // silently — the server can't run anyway, and re-seeding with a bogus
      // path would just produce confusing connect failures in the UI.
      continue;
    }
    const existing = db
      .prepare("SELECT id, enabled FROM mcp_servers WHERE id=?")
      .get(spec.id) as { id: string; enabled: number } | undefined;
    // First-run UX: if the user hasn't bootstrapped yet, ship the entry
    // disabled so it doesn't generate a perpetual "Connection closed" badge.
    // Once bootstrap.sh runs, ensureBuiltinMcpServers() flips it back on
    // on the next boot — but we never DOWNgrade `enabled` for a server the
    // user explicitly toggled, only on first insert.
    const ready = isBuiltinBootstrapped(spec);
    if (existing) {
      db.prepare(
        `UPDATE mcp_servers
           SET name=?, description=?, url=?, command=?, transport=?, source=?, builtin=1, tier=?
         WHERE id=?`
      ).run(
        spec.name,
        spec.description,
        launcher,
        launcher,
        "stdio",
        "builtin",
        spec.defaultToolTier,
        spec.id
      );
    } else {
      db.prepare(
        `INSERT INTO mcp_servers
          (id,name,url,description,tier,enabled,created_at,transport,source,env_encrypted,command,allowlist,builtin)
         VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,1)`
      ).run(
        spec.id,
        spec.name,
        launcher,
        spec.description,
        spec.defaultToolTier,
        ready ? 1 : 0,
        now,
        "stdio",
        "builtin",
        launcher,
        "[]"
      );
    }
  }
}
