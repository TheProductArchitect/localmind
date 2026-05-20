import crypto from "crypto";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { KEYDATA_FILE, ensureDataDir } from "./paths";

function machineId(): string {
  try {
    const out = execSync("ioreg -d2 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $4}'", {
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch {}
  return os.hostname() + os.platform();
}

function getSalt(): Buffer {
  ensureDataDir();
  if (fs.existsSync(KEYDATA_FILE)) return fs.readFileSync(KEYDATA_FILE);
  const salt = crypto.randomBytes(32);
  fs.writeFileSync(KEYDATA_FILE, salt, { mode: 0o600 });
  return salt;
}

function deriveKey(): Buffer {
  return crypto.pbkdf2Sync(machineId(), getSalt(), 100_000, 32, "sha256");
}

export function encrypt(plain: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(b64: string): string {
  const data = Buffer.from(b64, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);
  const key = deriveKey();
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
