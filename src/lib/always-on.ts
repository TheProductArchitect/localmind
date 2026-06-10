/**
 * "Run LocalMind always" — produces an OS service definition that keeps the
 * Node process alive across logout/sleep so the in-process cron scheduler
 * can actually fire on schedule.
 *
 * macOS: a per-user LaunchAgent plist at ~/Library/LaunchAgents/com.localmind.app.plist.
 *   launchd handles RunAtLoad + KeepAlive; if the process exits, launchd
 *   restarts it. The plist runs npm start from the repo root and inherits
 *   the user's locale + PATH.
 *
 * Linux: a systemd user unit at ~/.config/systemd/user/localmind.service.
 *   `systemctl --user enable --now localmind` boots it; `loginctl enable-linger`
 *   keeps it running after logout.
 *
 * We write the file contents and return paths + commands the user (or the
 * settings page) runs to activate it. We never execute the activation
 * commands ourselves — installing a system service is the textbook action
 * that deserves an explicit user confirmation step.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type PlatformKind = "macos" | "linux" | "unsupported";

export function platformKind(): PlatformKind {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  return "unsupported";
}

const SERVICE_LABEL = "com.localmind.app";

export function repoRoot(): string {
  // The repo root is the cwd that `next start` runs from. We assume the user
  // launched LocalMind from its checkout; if they didn't, the activation
  // commands won't find package.json and they'll need to fix the WorkingDirectory.
  return process.cwd();
}

function macPlistContents(opts: { node: string; npm: string; workingDir: string; logDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.npm}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${opts.workingDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path.dirname(opts.node)}:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${opts.logDir}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${opts.logDir}/stderr.log</string>
</dict>
</plist>
`;
}

function linuxUnitContents(opts: { node: string; npm: string; workingDir: string }): string {
  return `[Unit]
Description=LocalMind ambient server
After=network-online.target

[Service]
WorkingDirectory=${opts.workingDir}
Environment=NODE_ENV=production
Environment=PATH=${path.dirname(opts.node)}:/usr/local/bin:/usr/bin:/bin
ExecStart=${opts.npm} start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export type InstallPlan =
  | {
      platform: "macos";
      service_path: string;
      contents: string;
      activate_commands: string[];
      deactivate_commands: string[];
    }
  | {
      platform: "linux";
      service_path: string;
      contents: string;
      activate_commands: string[];
      deactivate_commands: string[];
    }
  | { platform: "unsupported"; reason: string };

export function planInstall(opts?: { nodePath?: string; npmPath?: string }): InstallPlan {
  const kind = platformKind();
  if (kind === "unsupported") {
    return {
      platform: "unsupported",
      reason: `No always-on template for platform '${process.platform}'. You can still run LocalMind with any tool that supervises Node processes (pm2, docker, screen).`,
    };
  }
  const node = opts?.nodePath || process.execPath;
  const npm = opts?.npmPath || "/usr/local/bin/npm";
  const workingDir = repoRoot();

  if (kind === "macos") {
    const logDir = path.join(os.homedir(), "Library", "Logs", "LocalMind");
    const servicePath = path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    return {
      platform: "macos",
      service_path: servicePath,
      contents: macPlistContents({ node, npm, workingDir, logDir }),
      activate_commands: [
        `mkdir -p "${logDir}"`,
        `launchctl bootstrap gui/$(id -u) "${servicePath}"`,
        `launchctl enable gui/$(id -u)/${SERVICE_LABEL}`,
        `launchctl kickstart -k gui/$(id -u)/${SERVICE_LABEL}`,
      ],
      deactivate_commands: [
        `launchctl bootout gui/$(id -u)/${SERVICE_LABEL}`,
        `rm -f "${servicePath}"`,
      ],
    };
  }

  // linux
  const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
  const servicePath = path.join(unitDir, "localmind.service");
  return {
    platform: "linux",
    service_path: servicePath,
    contents: linuxUnitContents({ node, npm, workingDir }),
    activate_commands: [
      `mkdir -p "${unitDir}"`,
      `systemctl --user daemon-reload`,
      `systemctl --user enable --now localmind.service`,
      `loginctl enable-linger "$USER"`,
    ],
    deactivate_commands: [
      `systemctl --user disable --now localmind.service`,
      `rm -f "${servicePath}"`,
      `systemctl --user daemon-reload`,
    ],
  };
}

/** Write the unit file (does NOT run the activation commands). */
export async function writeUnitFile(plan: InstallPlan): Promise<void> {
  if (plan.platform === "unsupported") throw new Error(plan.reason);
  await fs.mkdir(path.dirname(plan.service_path), { recursive: true });
  await fs.writeFile(plan.service_path, plan.contents, { mode: 0o644 });
}

/** Returns true if the unit file is present on disk (does NOT prove it's loaded). */
export async function isInstalled(): Promise<boolean> {
  const plan = planInstall();
  if (plan.platform === "unsupported") return false;
  try {
    await fs.access(plan.service_path);
    return true;
  } catch {
    return false;
  }
}

/** Remove the unit file. (Caller is expected to run deactivate commands first.) */
export async function removeUnitFile(): Promise<void> {
  const plan = planInstall();
  if (plan.platform === "unsupported") return;
  try { await fs.unlink(plan.service_path); } catch { /* already gone */ }
}
