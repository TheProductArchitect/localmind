import { execFile, spawn } from "child_process";

// Execution boundary for agent-initiated shell commands.
//
// The framework's "Hands" layer warns against letting a coding agent run shell
// commands directly on the host. This module runs those commands inside a
// container (Docker / OrbStack-compatible CLI) instead, mounting only the
// directories the agent has been granted access to. AppleScript / Mac-automation
// stay host-bound on purpose and do NOT go through here.

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

export type SandboxRunOptions = {
  // Shell command to run inside the container.
  command: string;
  // Host directory to use as the working directory. Must be one of `mounts`
  // (or contained within one) so it is reachable inside the container.
  workdir: string;
  // Host directories to mount read-write into the container. Only these paths
  // are visible to the command; the rest of the host filesystem is not.
  mounts: string[];
  timeoutMs?: number;
};

export type SandboxResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

// The container image used to run commands. A single sensible default is enough;
// override with LOCALMIND_SANDBOX_IMAGE for a different toolchain.
const DEFAULT_IMAGE = "node:20-bookworm-slim";

function sandboxImage(): string {
  return process.env.LOCALMIND_SANDBOX_IMAGE || DEFAULT_IMAGE;
}

// Container runtime binary (docker CLI is provided by both Docker and OrbStack).
function runtimeBin(): string {
  return process.env.LOCALMIND_CONTAINER_RUNTIME || "docker";
}

let runtimeAvailable: boolean | null = null;

// Detects whether a usable container runtime is present and its daemon is up.
// Result is cached for the process lifetime to avoid repeated daemon probes.
export async function detectContainerRuntime(force = false): Promise<boolean> {
  if (!force && runtimeAvailable !== null) return runtimeAvailable;
  const bin = runtimeBin();
  runtimeAvailable = await new Promise<boolean>((resolve) => {
    execFile(bin, ["info"], { timeout: 8000 }, (err) => resolve(!err));
  });
  return runtimeAvailable;
}

export function containerRuntimeName(): string {
  return runtimeBin();
}

function unavailableMessage(): string {
  const bin = runtimeBin();
  return (
    `Command execution is sandboxed and requires a container runtime, but none is available. ` +
    `Install and start Docker or OrbStack (the "${bin}" command must work, e.g. "${bin} info"), then try again. ` +
    `Commands are never run directly on the host for safety.`
  );
}

// Runs a command inside a container with only the approved directories mounted.
// Throws SandboxUnavailableError if no container runtime is present — it never
// falls back to host execution.
export async function runInSandbox(opts: SandboxRunOptions): Promise<SandboxResult> {
  const available = await detectContainerRuntime();
  if (!available) throw new SandboxUnavailableError(unavailableMessage());

  const bin = runtimeBin();
  const image = sandboxImage();
  const timeoutMs = opts.timeoutMs ?? 120000;

  const mounts = Array.from(new Set(opts.mounts.filter(Boolean)));
  if (mounts.length === 0) {
    throw new SandboxUnavailableError(
      "No approved directories to mount into the sandbox; refusing to run with full host access."
    );
  }

  const args: string[] = ["run", "--rm", "-i"];
  for (const dir of mounts) {
    // Mount each approved dir at the same path inside the container so relative
    // and absolute references the agent uses keep working.
    args.push("-v", `${dir}:${dir}`);
  }
  args.push("-w", opts.workdir);
  args.push(image, "sh", "-c", opts.command);

  return new Promise<SandboxResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new SandboxUnavailableError(`Failed to start container runtime "${bin}": ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
