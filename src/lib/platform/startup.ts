import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import { PLATFORM } from "./index";

const GUARD_BEGIN = "# >>> localmind startup >>>";
const GUARD_END = "# <<< localmind startup <<<";

// ---- macOS launchd ----

function macPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", "com.localmind.plist");
}

function macPlistBody(pm2Path: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localmind</string>
  <key>ProgramArguments</key>
  <array><string>${pm2Path}</string><string>resurrect</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
}

function which(cmd: string): string {
  const r = spawnSync("/usr/bin/env", ["bash", "-c", `command -v ${cmd}`], { encoding: "utf8" });
  return (r.stdout || "").trim();
}

// ---- Linux systemd ----

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", "localmind.service");
}

function systemdUnitBody(): string {
  const appDir = path.join(os.homedir(), "LocalMind");
  const pm2 = which("pm2") || "pm2";
  return `[Unit]
Description=LocalMind
After=network.target

[Service]
Type=forking
ExecStart=${pm2} resurrect
ExecStop=${pm2} kill
Restart=on-failure
WorkingDirectory=${appDir}

[Install]
WantedBy=default.target
`;
}

// ---- WSL2 .bashrc hook ----

function shellRcPaths(): string[] {
  const home = os.homedir();
  return [path.join(home, ".bashrc"), path.join(home, ".zshrc")].filter((p) => existsSync(p));
}

function bashHookBody(): string {
  const appDir = path.join(os.homedir(), "LocalMind");
  return `${GUARD_BEGIN}
command -v pm2 >/dev/null && pm2 list >/dev/null 2>&1 || (cd "${appDir}" && pm2 start ecosystem.config.js >/dev/null 2>&1)
${GUARD_END}
`;
}

function appendGuarded(file: string, body: string): void {
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (cur.includes(GUARD_BEGIN)) return; // already installed
  writeFileSync(file, cur + (cur.endsWith("\n") ? "" : "\n") + body);
}

function removeGuarded(file: string): boolean {
  if (!existsSync(file)) return false;
  const cur = readFileSync(file, "utf8");
  const re = new RegExp(`\\n?${GUARD_BEGIN}[\\s\\S]*?${GUARD_END}\\n?`, "g");
  if (!re.test(cur)) return false;
  writeFileSync(file, cur.replace(re, "\n"));
  return true;
}

// ---- Public API ----

export type StartupResult = { ok: boolean; message: string; mechanism?: string };

export async function enableStartup(): Promise<StartupResult> {
  try {
    if (PLATFORM === "macos-arm64" || PLATFORM === "macos-x86") {
      const pm2 = which("pm2");
      if (!pm2) return { ok: false, message: "PM2 not found in PATH — install it before enabling startup." };
      const plist = macPlistPath();
      mkdirSync(path.dirname(plist), { recursive: true });
      writeFileSync(plist, macPlistBody(pm2));
      spawnSync("launchctl", ["unload", plist]);
      const r = spawnSync("launchctl", ["load", plist]);
      return r.status === 0
        ? { ok: true, message: "Login startup enabled via launchd.", mechanism: "launchd" }
        : { ok: false, message: "launchctl load failed — plist written but not active." };
    }
    if (PLATFORM === "ubuntu" || PLATFORM === "debian") {
      const unit = systemdUnitPath();
      mkdirSync(path.dirname(unit), { recursive: true });
      writeFileSync(unit, systemdUnitBody());
      spawnSync("systemctl", ["--user", "daemon-reload"]);
      const r = spawnSync("systemctl", ["--user", "enable", "--now", "localmind"]);
      return r.status === 0
        ? { ok: true, message: "Login startup enabled via systemd user service.", mechanism: "systemd" }
        : { ok: false, message: "systemctl enable failed — unit file written but not active." };
    }
    if (PLATFORM === "wsl2") {
      const rcFiles = shellRcPaths();
      if (rcFiles.length === 0) {
        // Create .bashrc if neither shell file exists.
        const bashrc = path.join(os.homedir(), ".bashrc");
        writeFileSync(bashrc, bashHookBody());
        return { ok: true, message: "Startup hook added to ~/.bashrc.", mechanism: "bashrc" };
      }
      for (const f of rcFiles) appendGuarded(f, bashHookBody());
      return { ok: true, message: `Startup hook added to ${rcFiles.map((f) => path.basename(f)).join(", ")}.`, mechanism: "bashrc" };
    }
    return { ok: false, message: "Login startup is not supported on this platform." };
  } catch (e) {
    return { ok: false, message: `Could not enable startup: ${(e as Error).message}` };
  }
}

export async function disableStartup(): Promise<StartupResult> {
  try {
    if (PLATFORM === "macos-arm64" || PLATFORM === "macos-x86") {
      const plist = macPlistPath();
      if (existsSync(plist)) {
        spawnSync("launchctl", ["unload", plist]);
        unlinkSync(plist);
      }
      return { ok: true, message: "Login startup disabled.", mechanism: "launchd" };
    }
    if (PLATFORM === "ubuntu" || PLATFORM === "debian") {
      spawnSync("systemctl", ["--user", "disable", "--now", "localmind"]);
      const unit = systemdUnitPath();
      if (existsSync(unit)) unlinkSync(unit);
      return { ok: true, message: "Login startup disabled.", mechanism: "systemd" };
    }
    if (PLATFORM === "wsl2") {
      let removed = false;
      for (const f of shellRcPaths()) if (removeGuarded(f)) removed = true;
      return { ok: true, message: removed ? "Startup hook removed." : "No startup hook was installed.", mechanism: "bashrc" };
    }
    return { ok: false, message: "Login startup is not supported on this platform." };
  } catch (e) {
    return { ok: false, message: `Could not disable startup: ${(e as Error).message}` };
  }
}

export async function getStartupStatus(): Promise<{ enabled: boolean; mechanism: string }> {
  if (PLATFORM === "macos-arm64" || PLATFORM === "macos-x86") {
    return { enabled: existsSync(macPlistPath()), mechanism: "launchd" };
  }
  if (PLATFORM === "ubuntu" || PLATFORM === "debian") {
    return { enabled: existsSync(systemdUnitPath()), mechanism: "systemd" };
  }
  if (PLATFORM === "wsl2") {
    const enabled = shellRcPaths().some((f) => readFileSync(f, "utf8").includes(GUARD_BEGIN));
    return { enabled, mechanism: "bashrc" };
  }
  return { enabled: false, mechanism: "unsupported" };
}
