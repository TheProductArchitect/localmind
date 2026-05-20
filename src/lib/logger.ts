import fs from "fs";
import path from "path";
import { LOGS_DIR, ensureDataDir } from "./paths";

export type LogLevel = "debug" | "info" | "warn" | "error";

function logFile(): string {
  ensureDataDir();
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `app-${day}.log`);
}

export function log(level: LogLevel, message: string, meta?: unknown) {
  const line =
    JSON.stringify({ ts: Date.now(), level, message, ...(meta ? { meta } : {}) }) + "\n";
  try {
    fs.appendFileSync(logFile(), line);
  } catch {}
}

export const logger = {
  debug: (m: string, meta?: unknown) => log("debug", m, meta),
  info: (m: string, meta?: unknown) => log("info", m, meta),
  warn: (m: string, meta?: unknown) => log("warn", m, meta),
  error: (m: string, meta?: unknown) => log("error", m, meta),
};

export function currentLogPath(): string {
  return logFile();
}

export function readRecentLogLines(limit = 500): string[] {
  try {
    const content = fs.readFileSync(logFile(), "utf8");
    return content.split("\n").filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}
