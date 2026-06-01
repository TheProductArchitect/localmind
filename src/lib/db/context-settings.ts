import { getConfigDb } from ".";

export type CompressionStrategy = "summarise" | "truncate" | "sliding_window";

export type ContextSettings = {
  settings_id: string;
  persona_id: string | null;
  compression_threshold_pct: number;
  compression_target_pct: number;
  compression_strategy: CompressionStrategy;
  summarisation_model: string | null;
  tool_result_max_chars: number;
  per_conversation_override_enabled: number;
  updated_at: number;
};

export type ContextSettingsPatch = Partial<
  Pick<
    ContextSettings,
    | "compression_threshold_pct"
    | "compression_target_pct"
    | "compression_strategy"
    | "summarisation_model"
    | "tool_result_max_chars"
    | "per_conversation_override_enabled"
  >
>;

const GLOBAL_ID = "ctx-global";

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function getGlobalContextSettings(): ContextSettings {
  const row = getConfigDb()
    .prepare("SELECT * FROM context_window_settings WHERE settings_id=?")
    .get(GLOBAL_ID) as ContextSettings | undefined;
  if (row) return row;
  // Defensive fallback if the V6 seed was somehow skipped.
  const defaults: ContextSettings = {
    settings_id: GLOBAL_ID,
    persona_id: null,
    compression_threshold_pct: 80,
    compression_target_pct: 50,
    compression_strategy: "summarise",
    summarisation_model: null,
    tool_result_max_chars: 4000,
    per_conversation_override_enabled: 0,
    updated_at: readNow(),
  };
  getConfigDb()
    .prepare(
      `INSERT INTO context_window_settings
        (settings_id, persona_id, compression_threshold_pct, compression_target_pct,
         compression_strategy, summarisation_model, tool_result_max_chars,
         per_conversation_override_enabled, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      defaults.settings_id,
      null,
      defaults.compression_threshold_pct,
      defaults.compression_target_pct,
      defaults.compression_strategy,
      null,
      defaults.tool_result_max_chars,
      defaults.per_conversation_override_enabled,
      defaults.updated_at
    );
  return defaults;
}

export function getPersonaContextSettings(personaId: string): ContextSettings | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM context_window_settings WHERE persona_id=?")
      .get(personaId) as ContextSettings | undefined) || null
  );
}

/** Upserts the global row. */
export function updateGlobalContextSettings(patch: ContextSettingsPatch): ContextSettings {
  getGlobalContextSettings(); // ensure row exists
  const keys = Object.keys(patch);
  if (keys.length > 0) {
    const set = keys.map((k) => `${k}=@${k}`).join(", ");
    getConfigDb()
      .prepare(`UPDATE context_window_settings SET ${set}, updated_at=@updated_at WHERE settings_id=@id`)
      .run({ ...patch, id: GLOBAL_ID, updated_at: readNow() } as Record<string, unknown>);
  }
  return getGlobalContextSettings();
}

/** Upserts the per-persona override. */
export function upsertPersonaContextSettings(
  personaId: string,
  patch: ContextSettingsPatch
): ContextSettings {
  const existing = getPersonaContextSettings(personaId);
  if (existing) {
    const keys = Object.keys(patch);
    if (keys.length > 0) {
      const set = keys.map((k) => `${k}=@${k}`).join(", ");
      getConfigDb()
        .prepare(`UPDATE context_window_settings SET ${set}, updated_at=@updated_at WHERE persona_id=@pid`)
        .run({ ...patch, pid: personaId, updated_at: readNow() } as Record<string, unknown>);
    }
    return getPersonaContextSettings(personaId)!;
  }
  const base = getGlobalContextSettings();
  const row = { ...base, ...patch } as ContextSettings;
  getConfigDb()
    .prepare(
      `INSERT INTO context_window_settings
        (settings_id, persona_id, compression_threshold_pct, compression_target_pct,
         compression_strategy, summarisation_model, tool_result_max_chars,
         per_conversation_override_enabled, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `ctx-${personaId}`,
      personaId,
      row.compression_threshold_pct,
      row.compression_target_pct,
      row.compression_strategy,
      row.summarisation_model,
      row.tool_result_max_chars,
      row.per_conversation_override_enabled,
      readNow()
    );
  return getPersonaContextSettings(personaId)!;
}

/** Resolves the effective settings: per-persona override if any, otherwise global. */
export function resolveContextSettings(personaId?: string | null): ContextSettings {
  if (personaId) {
    const p = getPersonaContextSettings(personaId);
    if (p) return p;
  }
  return getGlobalContextSettings();
}
