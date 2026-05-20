import { getConfigDb } from ".";
import { encrypt, decrypt } from "../crypto";

export function setApiKey(provider: string, key: string) {
  getConfigDb()
    .prepare(
      "INSERT INTO api_keys (provider, encrypted_key, updated_at) VALUES (?,?,?) " +
        "ON CONFLICT(provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, updated_at=excluded.updated_at"
    )
    .run(provider, encrypt(key), Date.now());
}

export function getApiKey(provider: string): string | null {
  const r = getConfigDb()
    .prepare("SELECT encrypted_key FROM api_keys WHERE provider=?")
    .get(provider) as { encrypted_key: string } | undefined;
  if (!r) return null;
  try {
    return decrypt(r.encrypted_key);
  } catch {
    return null;
  }
}

export function listConnectedProviders(): string[] {
  return (getConfigDb().prepare("SELECT provider FROM api_keys").all() as { provider: string }[]).map(
    (r) => r.provider
  );
}

export function deleteApiKey(provider: string) {
  getConfigDb().prepare("DELETE FROM api_keys WHERE provider=?").run(provider);
}
