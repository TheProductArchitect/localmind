import { execFile } from "child_process";

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
