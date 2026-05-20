import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type Role = "owner" | "member" | "guest" | string;

export type User = {
  id: string;
  display_name: string;
  role: Role;
  auth_method: string;
  pin_hash: string | null;
  permission_profile_id: string | null;
  allowed_channels: string;
  avatar: string | null;
  created_at: number;
  last_login_at: number | null;
  active: number;
};

export type Session = {
  id: string;
  user_id: string;
  device: string | null;
  ip: string | null;
  auth_method: string | null;
  created_at: number;
  last_active_at: number;
  expires_at: number;
  refresh_token_hash: string | null;
};

export function countUsers(): number {
  return (getConfigDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

export function listUsers(): User[] {
  return getConfigDb().prepare("SELECT * FROM users WHERE active=1 ORDER BY created_at").all() as User[];
}

export function getUser(id: string): User | null {
  return (getConfigDb().prepare("SELECT * FROM users WHERE id=?").get(id) as User) || null;
}

export function getOwner(): User | null {
  return (
    (getConfigDb().prepare("SELECT * FROM users WHERE role='owner' AND active=1 LIMIT 1").get() as User) ||
    null
  );
}

export function createUser(opts: {
  display_name: string;
  role: Role;
  pin_hash?: string | null;
  permission_profile_id?: string | null;
  allowed_channels?: string[];
}): User {
  const id = nanoid(12);
  const now = Date.now();
  getConfigDb()
    .prepare(
      "INSERT INTO users (id,display_name,role,auth_method,pin_hash,permission_profile_id,allowed_channels,created_at,active) VALUES (?,?,?,?,?,?,?,?,1)"
    )
    .run(
      id,
      opts.display_name,
      opts.role,
      "pin",
      opts.pin_hash ?? null,
      opts.permission_profile_id ?? null,
      JSON.stringify(opts.allowed_channels ?? []),
      now
    );
  return getUser(id)!;
}

export function updateUser(id: string, patch: Partial<User> & { allowed_channels?: any }) {
  const p: any = { ...patch };
  if (Array.isArray(p.allowed_channels)) p.allowed_channels = JSON.stringify(p.allowed_channels);
  const keys = Object.keys(p);
  if (!keys.length) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getConfigDb().prepare(`UPDATE users SET ${set} WHERE id=@id`).run({ ...p, id });
}

export function deactivateUser(id: string) {
  getConfigDb().prepare("UPDATE users SET active=0 WHERE id=?").run(id);
}

// ---- Sessions ----
export function createSession(opts: {
  user_id: string;
  device?: string;
  ip?: string;
  auth_method?: string;
  ttlMs: number;
  refresh_token_hash?: string;
}): Session {
  const id = nanoid(16);
  const now = Date.now();
  getConfigDb()
    .prepare(
      "INSERT INTO sessions (id,user_id,device,ip,auth_method,created_at,last_active_at,expires_at,refresh_token_hash) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(id, opts.user_id, opts.device ?? null, opts.ip ?? null, opts.auth_method ?? "pin", now, now, now + opts.ttlMs, opts.refresh_token_hash ?? null);
  return getConfigDb().prepare("SELECT * FROM sessions WHERE id=?").get(id) as Session;
}

export function listSessions(userId?: string): Session[] {
  const db = getConfigDb();
  if (userId) return db.prepare("SELECT * FROM sessions WHERE user_id=? ORDER BY last_active_at DESC").all(userId) as Session[];
  return db.prepare("SELECT * FROM sessions ORDER BY last_active_at DESC").all() as Session[];
}

export function getSession(id: string): Session | null {
  return (getConfigDb().prepare("SELECT * FROM sessions WHERE id=?").get(id) as Session) || null;
}

export function touchSession(id: string) {
  getConfigDb().prepare("UPDATE sessions SET last_active_at=? WHERE id=?").run(Date.now(), id);
}

export function revokeSession(id: string) {
  getConfigDb().prepare("DELETE FROM sessions WHERE id=?").run(id);
}

export function findSessionByRefresh(hash: string): Session | null {
  return (
    (getConfigDb().prepare("SELECT * FROM sessions WHERE refresh_token_hash=?").get(hash) as Session) ||
    null
  );
}

export function rotateRefresh(sessionId: string, newHash: string, ttlMs: number) {
  getConfigDb()
    .prepare("UPDATE sessions SET refresh_token_hash=?, expires_at=?, last_active_at=? WHERE id=?")
    .run(newHash, Date.now() + ttlMs, Date.now(), sessionId);
}

// ---- Roles ----
export type RoleRow = { id: string; name: string; allowed_tools: string; builtin: number; created_at: number };

export function listRoles(): RoleRow[] {
  return getConfigDb().prepare("SELECT * FROM roles ORDER BY builtin DESC, created_at").all() as RoleRow[];
}

export function getRole(id: string): RoleRow | null {
  return (getConfigDb().prepare("SELECT * FROM roles WHERE id=?").get(id) as RoleRow) || null;
}

export function createRole(name: string, tools: string[]): RoleRow {
  const id = nanoid(10);
  getConfigDb()
    .prepare("INSERT INTO roles (id,name,allowed_tools,builtin,created_at) VALUES (?,?,?,0,?)")
    .run(id, name, JSON.stringify(tools), Date.now());
  return getRole(id)!;
}
