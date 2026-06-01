import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type DatastoreTable = {
  table_name: string;
  schema_json: string;          // JSON
  row_count: number;
  created_at: number;
  updated_at: number;
};

export type DatastoreRecord = {
  record_id: string;
  table_name: string;
  data_json: string;            // JSON
  created_at: number;
  updated_at: number;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

function isValidTableName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name);
}

export function listTables(): DatastoreTable[] {
  return getConfigDb()
    .prepare("SELECT * FROM datastore_tables ORDER BY table_name")
    .all() as DatastoreTable[];
}

export function getTable(name: string): DatastoreTable | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM datastore_tables WHERE table_name=?")
      .get(name) as DatastoreTable | undefined) || null
  );
}

export function ensureTable(name: string, schema?: Record<string, unknown>): DatastoreTable {
  if (!isValidTableName(name)) {
    throw new Error(
      `Invalid table name "${name}" — use letters, digits, underscores, and dashes (must start with a letter).`
    );
  }
  const existing = getTable(name);
  if (existing) return existing;
  const now = readNow();
  getConfigDb()
    .prepare(
      "INSERT INTO datastore_tables (table_name, schema_json, row_count, created_at, updated_at) VALUES (?,?,?,?,?)"
    )
    .run(name, JSON.stringify(schema ?? {}), 0, now, now);
  return getTable(name)!;
}

export function dropTable(name: string): boolean {
  const db = getConfigDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM datastore_records WHERE table_name=?").run(name);
    const r = db.prepare("DELETE FROM datastore_tables WHERE table_name=?").run(name);
    return r.changes > 0;
  });
  return tx();
}

export function putRecord(tableName: string, data: Record<string, unknown>): DatastoreRecord {
  ensureTable(tableName);
  const id = `rec-${nanoid(12)}`;
  const now = readNow();
  const db = getConfigDb();
  db.prepare(
    "INSERT INTO datastore_records (record_id, table_name, data_json, created_at, updated_at) VALUES (?,?,?,?,?)"
  ).run(id, tableName, JSON.stringify(data), now, now);
  db.prepare(
    "UPDATE datastore_tables SET row_count = row_count + 1, updated_at=? WHERE table_name=?"
  ).run(now, tableName);
  return {
    record_id: id,
    table_name: tableName,
    data_json: JSON.stringify(data),
    created_at: now,
    updated_at: now,
  };
}

export function listRecords(
  tableName: string,
  opts: { limit?: number; filter?: Record<string, unknown>; offset?: number } = {}
): DatastoreRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = getConfigDb()
    .prepare(
      "SELECT * FROM datastore_records WHERE table_name=? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .all(tableName, limit, offset) as DatastoreRecord[];

  if (!opts.filter || Object.keys(opts.filter).length === 0) return rows;

  // Filtering is JSON-object equality on top-level keys; runs in JS rather than
  // SQL JSON1 so we don't assume the build was compiled with json1.
  return rows.filter((r) => {
    try {
      const d = JSON.parse(r.data_json) as Record<string, unknown>;
      for (const [k, v] of Object.entries(opts.filter!)) {
        if (d[k] !== v) return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

export function deleteRecord(tableName: string, recordId: string): boolean {
  const db = getConfigDb();
  const tx = db.transaction(() => {
    const r = db
      .prepare("DELETE FROM datastore_records WHERE table_name=? AND record_id=?")
      .run(tableName, recordId);
    if (r.changes > 0) {
      db.prepare(
        "UPDATE datastore_tables SET row_count = MAX(row_count - 1, 0), updated_at=? WHERE table_name=?"
      ).run(readNow(), tableName);
    }
    return r.changes > 0;
  });
  return tx();
}
