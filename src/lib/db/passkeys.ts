import { getConfigDb } from ".";

export type PasskeyCredential = {
  credential_id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: number;
  last_used_at: number | null;
};

export function listPasskeys(userId: string): PasskeyCredential[] {
  return getConfigDb()
    .prepare("SELECT * FROM passkey_credentials WHERE user_id=?")
    .all(userId) as PasskeyCredential[];
}

export function getPasskey(credentialId: string): PasskeyCredential | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM passkey_credentials WHERE credential_id=?")
      .get(credentialId) as PasskeyCredential) || null
  );
}

export function savePasskey(c: {
  credential_id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports?: string[];
}) {
  getConfigDb()
    .prepare(
      "INSERT INTO passkey_credentials (credential_id,user_id,public_key,counter,transports,created_at) VALUES (?,?,?,?,?,?)"
    )
    .run(c.credential_id, c.user_id, c.public_key, c.counter, JSON.stringify(c.transports || []), Date.now());
}

export function updatePasskeyCounter(credentialId: string, counter: number) {
  getConfigDb()
    .prepare("UPDATE passkey_credentials SET counter=?, last_used_at=? WHERE credential_id=?")
    .run(counter, Date.now(), credentialId);
}

export function deletePasskey(credentialId: string) {
  getConfigDb().prepare("DELETE FROM passkey_credentials WHERE credential_id=?").run(credentialId);
}
