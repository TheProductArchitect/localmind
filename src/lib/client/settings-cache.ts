/**
 * Shared client settings cache — one network fetch, many consumers.
 * Stale-while-revalidate with sessionStorage so model/mode/font paint instantly
 * on remount / navigation.
 */

export type ClientSettings = Record<string, unknown> & {
  assistant_name?: string;
  active_model?: string | null;
  provider?: string;
  agent_mode?: string;
  chat_font_size?: number;
  onboarded?: number | boolean;
  compute_placement?: string;
  workspace_placement?: string;
  tool_home_placement?: string;
};

type CacheEntry = { at: number; settings: ClientSettings };

const STORAGE_KEY = "lm.settings.cache.v1";
const TTL_MS = 60_000;
const inflight = { p: null as Promise<ClientSettings> | null };
let mem: CacheEntry | null = null;
const listeners = new Set<(s: ClientSettings) => void>();

function readStorage(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.settings || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

function publish(settings: ClientSettings) {
  for (const cb of listeners) {
    try {
      cb(settings);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Sync peek — memory first, then sessionStorage. */
export function peekSettings(): ClientSettings | null {
  if (mem) return mem.settings;
  const stored = readStorage();
  if (stored) {
    mem = stored;
    return stored.settings;
  }
  return null;
}

export function subscribeSettings(cb: (s: ClientSettings) => void): () => void {
  listeners.add(cb);
  const cur = peekSettings();
  if (cur) cb(cur);
  return () => {
    listeners.delete(cb);
  };
}

/** Apply a local patch (after PATCH) so UI updates without a round-trip. */
export function patchSettingsCache(partial: Partial<ClientSettings>) {
  const base = peekSettings() || {};
  const next = { ...base, ...partial };
  mem = { at: Date.now(), settings: next };
  writeStorage(mem);
  publish(next);
}

export function invalidateSettingsCache() {
  mem = null;
  inflight.p = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export async function fetchSettings(opts?: { force?: boolean }): Promise<ClientSettings> {
  const force = !!opts?.force;
  const now = Date.now();
  if (!force && mem && now - mem.at < TTL_MS) return mem.settings;
  if (!force && !mem) {
    const stored = readStorage();
    if (stored) {
      mem = stored;
      // Revalidate in background when stale
      if (now - stored.at < TTL_MS) return stored.settings;
    }
  }
  if (inflight.p) return inflight.p;

  inflight.p = (async () => {
    const r = await fetch("/api/settings", { cache: "no-store" });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    const j = await r.json();
    const settings = (j.settings || {}) as ClientSettings;
    mem = { at: Date.now(), settings };
    writeStorage(mem);
    publish(settings);
    return settings;
  })().finally(() => {
    inflight.p = null;
  });

  return inflight.p;
}
