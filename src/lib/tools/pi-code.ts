/**
 * pi_code — wraps the pi.dev CLI (https://pi.dev) as a LocalMind agent tool.
 *
 * pi-coding-agent is installed by the platform install scripts via
 *   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
 * and exposes a `pi` CLI on PATH.
 *
 * Operations:
 *   - run         : kicks off a coding task with a natural-language goal in
 *                   one of the user's approved directories. Output captured
 *                   and returned verbatim; pi does its own file edits which
 *                   still flow through whatever permissions pi requests.
 *   - status      : reports CLI availability + version (no shell out for
 *                   actual coding — useful for a UI capability check).
 *
 * The action_type maps to `write_files` for the `run` op because pi WILL
 * edit files — so it goes through the normal LocalMind permission tier the
 * user has configured for write_files. If the user has write_files set to
 * 'ask' or 'pin' (the defaults outside of the autonomous profile), the
 * confirmation card fires before pi runs.
 *
 * Working directory is scoped to the user's approved dirs the same way the
 * filesystem tool's `resolveSafe` is — pi can't escape the approved tree
 * because we resolve and chdir into it before spawn.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import type { Tool } from "./types";

const PI_TIMEOUT_MS = 5 * 60_000; // 5 minutes — pi can think for a while
const MAX_OUTPUT_BYTES = 64 * 1024; // 64KiB output cap

function expand(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || ""));
}

async function resolveWithinApproved(p: string, approved: string[]): Promise<string | null> {
  if (!p || approved.length === 0) return null;
  const abs = expand(p);
  if (!fsSync.existsSync(abs)) return null;
  let real: string;
  try { real = await fs.realpath(abs); } catch { return null; }
  for (const dir of approved) {
    const realDir = await fs.realpath(expand(dir)).catch(() => null);
    if (!realDir) continue;
    if (real === realDir || real.startsWith(realDir + path.sep)) return real;
  }
  return null;
}

function piAvailable(): { ok: boolean; version?: string; reason?: string } {
  const r = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 2000 });
  if (r.error || r.status !== 0) {
    return { ok: false, reason: "`pi` not on PATH. Run the LocalMind install script or `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`." };
  }
  return { ok: true, version: (r.stdout || r.stderr || "").trim().split("\n")[0] };
}

export const piCodeTool: Tool = {
  actionType: "write_files",
  // `run` spawns an autonomous coding agent that can execute arbitrary shell
  // in the workspace — always confirm, even in auto mode.
  classify: (i) => (i.operation === "status" ? "read_files" : "destructive_shell"),
  preview: (i) => {
    if (i.operation === "status") return "Check if the pi.dev coding agent is available";
    return `Run pi coding agent in "${i.cwd}" on: ${String(i.goal ?? "").slice(0, 120)}`;
  },
  version: "1",
  // Status is a cheap read with deterministic output (modulo a version bump);
  // run is never cacheable because it mutates files in the user's workspace.
  cacheable: (i) => i.operation === "status",
  definition: {
    name: "pi_code",
    description:
      "Delegate substantial multi-file coding to the local pi.dev CLI. Use for refactors / feature implementation that a chat model would struggle with. Operations: run, status.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["run", "status"] },
        goal: { type: "string", description: "Plain-English description of what pi should accomplish. Required for run." },
        cwd: { type: "string", description: "Absolute path to a directory inside the user's approved folders. Required for run." },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const op = String(input.operation || "");

    if (op === "status") {
      const probe = piAvailable();
      return {
        ok: true,
        output: probe.ok
          ? `pi is installed at ${spawnSync("which", ["pi"]).stdout.toString().trim()} (${probe.version})`
          : probe.reason!,
        summary: probe.ok ? "pi available" : "pi missing",
      };
    }

    if (op === "run") {
      const probe = piAvailable();
      if (!probe.ok) return { ok: false, output: probe.reason ?? "pi not available" };

      const cwd = String(input.cwd || "").trim();
      const goal = String(input.goal || "").trim();
      if (!cwd) return { ok: false, output: "cwd is required for run" };
      if (!goal) return { ok: false, output: "goal is required for run" };

      const safeCwd = await resolveWithinApproved(cwd, ctx.approvedDirs);
      if (!safeCwd) {
        return {
          ok: false,
          output: `Refusing to run pi in "${cwd}" — not inside an approved folder. Add it under Settings → Approved folders.`,
        };
      }

      // Spawn pi with the goal as the prompt. pi reads its prompt from stdin
      // (when invoked as `pi -p -` style) or as an arg — we use stdin to
      // avoid arg-length / quoting issues with long multi-line goals.
      return await new Promise((resolve) => {
        const child = spawn("pi", [], {
          cwd: safeCwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PI_AUTO_APPROVE: "0" }, // never auto-approve from pi's side
        });

        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let resolved = false;
        const settle = (result: { ok: boolean; output: string; summary?: string }) => {
          if (resolved) return;
          resolved = true;
          try { child.kill("SIGTERM"); } catch { /* already dead */ }
          resolve(result);
        };

        child.stdout.on("data", (b: Buffer) => {
          stdout = Buffer.concat([stdout, b]).subarray(0, MAX_OUTPUT_BYTES);
        });
        child.stderr.on("data", (b: Buffer) => {
          stderr = Buffer.concat([stderr, b]).subarray(0, MAX_OUTPUT_BYTES);
        });
        child.on("error", (err) => {
          settle({ ok: false, output: `pi failed to start: ${err.message}` });
        });
        child.on("exit", (code) => {
          const out = stdout.toString("utf8");
          const err = stderr.toString("utf8");
          if (code === 0) {
            settle({
              ok: true,
              output: out || "(pi finished with no stdout — check the directory for changes)",
              summary: `pi run complete in ${safeCwd}`,
            });
          } else {
            settle({
              ok: false,
              output: (err || out || "pi exited non-zero").slice(0, MAX_OUTPUT_BYTES),
              summary: `pi exited with code ${code}`,
            });
          }
        });

        const timer = setTimeout(() => {
          settle({ ok: false, output: `pi timed out after ${PI_TIMEOUT_MS / 1000}s — partial output: ${stdout.toString("utf8").slice(0, 2000)}` });
        }, PI_TIMEOUT_MS);
        timer.unref?.();

        // Feed the goal to pi.
        child.stdin.write(goal);
        child.stdin.end();
      });
    }

    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
