import { execFile } from "child_process";

// Host-bound by design: AppleScript / Mac automation must run on the actual macOS
// host to control native apps, so it intentionally does NOT go through the command
// sandbox. Only arbitrary agent shell execution (see ./sandbox) is containerized.
export function runAppleScript(script: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
