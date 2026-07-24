import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type Persona = {
  persona_id: string;
  name: string;
  description: string | null;
  model_name: string | null;
  /** Chat provider for model_name; NULL inherits settings.provider. */
  provider: string | null;
  enabled_tools: string;            // JSON array
  permission_profile_id: string | null;
  created_at: number;
  updated_at: number;
};

const BUILTIN_PREFIX = "persona-";

function readNow(): number {
  const row = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return row.t;
}

export function listPersonas(): Persona[] {
  return getConfigDb()
    .prepare("SELECT * FROM personas ORDER BY persona_id = 'persona-general' DESC, created_at ASC")
    .all() as Persona[];
}

export function getPersona(id: string): Persona | null {
  return (
    (getConfigDb().prepare("SELECT * FROM personas WHERE persona_id=?").get(id) as Persona) || null
  );
}

export function createPersona(p: {
  name: string;
  description?: string | null;
  model_name?: string | null;
  provider?: string | null;
  enabled_tools?: string[];
  permission_profile_id?: string | null;
}): Persona {
  const id = `persona-${nanoid(8)}`;
  const now = readNow();
  getConfigDb()
    .prepare(
      "INSERT INTO personas (persona_id, name, description, model_name, provider, enabled_tools, permission_profile_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(
      id,
      p.name,
      p.description ?? null,
      p.model_name ?? null,
      p.provider ?? null,
      JSON.stringify(p.enabled_tools ?? []),
      p.permission_profile_id ?? null,
      now,
      now
    );
  return getPersona(id)!;
}

export function updatePersona(
  id: string,
  patch: Partial<Pick<Persona, "name" | "description" | "model_name" | "provider" | "enabled_tools" | "permission_profile_id">>
): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getConfigDb()
    .prepare(`UPDATE personas SET ${set}, updated_at=@updated_at WHERE persona_id=@id`)
    .run({ ...patch, id, updated_at: readNow() } as Record<string, unknown>);
}

export function isBuiltinPersona(id: string): boolean {
  return id === "persona-general" || id === "persona-devpm";
}

export function deletePersona(id: string): { ok: boolean; reason?: string } {
  if (isBuiltinPersona(id)) {
    return { ok: false, reason: "Built-in personas cannot be deleted." };
  }
  if (!id.startsWith(BUILTIN_PREFIX)) {
    return { ok: false, reason: "Invalid persona id." };
  }
  const db = getConfigDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM system_prompt_blocks WHERE persona_id=?").run(id);
    db.prepare("DELETE FROM context_window_settings WHERE persona_id=?").run(id);
    db.prepare("DELETE FROM personas WHERE persona_id=?").run(id);
  });
  tx();
  return { ok: true };
}
