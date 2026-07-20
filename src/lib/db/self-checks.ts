import { nanoid } from "nanoid";
import { getConfigDb } from ".";

// A recorded idle-time check (e.g. a `npm test` run). Read-only w.r.t. the app:
// the idle cycle runs tests, it never edits code (§7.1).
export type SelfCheck = {
  id: string;
  kind: string; // e.g. "tests" | "lint" | "outdated" | "audit"
  status: string; // "pass" | "fail" | "error"
  summary: string | null;
  detail: string | null;
  created_at: number;
};

export function recordSelfCheck(o: {
  kind: string;
  status: string;
  summary?: string;
  detail?: string;
}): SelfCheck {
  const id = `chk-${nanoid(10)}`;
  getConfigDb()
    .prepare("INSERT INTO self_checks (id,kind,status,summary,detail,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, o.kind, o.status, o.summary ?? null, (o.detail ?? "").slice(0, 8000), Date.now());
  return getConfigDb().prepare("SELECT * FROM self_checks WHERE id=?").get(id) as SelfCheck;
}

export function listSelfChecks(limit = 50): SelfCheck[] {
  return getConfigDb()
    .prepare("SELECT * FROM self_checks ORDER BY created_at DESC LIMIT ?")
    .all(limit) as SelfCheck[];
}
