import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR, ensureDataDir } from "../paths";

const SECRET_FILE = path.join(DATA_DIR, "jwt-secret");

function secret(): string {
  if (process.env.LOCALMIND_JWT_SECRET) return process.env.LOCALMIND_JWT_SECRET;
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8");
  const s = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export type JwtPayload = { userId: string; role: string; exp: number };

export function signJwt(payload: Omit<JwtPayload, "exp">, ttlSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const sig = crypto.createHmac("sha256", secret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${header}.${body}`)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
