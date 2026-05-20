import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { DATA_DIR } from "../paths";
import { logger } from "../logger";

const VEC_DYLIB = path.join(DATA_DIR, "extensions", "vec0.dylib");

let useNativeVec = false;
let checked = false;

// Attempts to load the sqlite-vec native extension on the knowledge connection.
export function loadVecExtension(db: Database.Database) {
  if (!fs.existsSync(VEC_DYLIB)) {
    useNativeVec = false;
    if (!checked) { logger.info("native vec unavailable — falling back to JS cosine"); checked = true; }
    return;
  }
  try {
    (db as any).loadExtension(VEC_DYLIB);
    db.prepare("SELECT vec_version()").get();
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[768])"
    );
    useNativeVec = true;
    if (!checked) { logger.info("native vec active — sqlite-vec loaded"); checked = true; }
  } catch (e: any) {
    useNativeVec = false;
    if (!checked) {
      logger.warn("native vec unavailable — falling back to JS cosine", { error: e?.message });
      checked = true;
    }
  }
}

export function isNativeVec(): boolean {
  return useNativeVec;
}

// Inserts an embedding into the native vec table (no-op when native vec is off).
export function vecInsert(db: Database.Database, chunkId: string, embedding: Float32Array) {
  if (!useNativeVec) return;
  try {
    db.prepare("INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)")
      .run(chunkId, Buffer.from(embedding.buffer));
  } catch (e: any) {
    logger.warn("vecInsert failed", { error: e?.message });
  }
}

export function vecDelete(db: Database.Database, chunkId: string) {
  if (!useNativeVec) return;
  try {
    db.prepare("DELETE FROM chunk_vectors WHERE chunk_id=?").run(chunkId);
  } catch {}
}

// Runs a native knn search, returning chunk IDs and distances.
export function vecSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k = 10
): { chunk_id: string; distance: number }[] {
  if (!useNativeVec) return [];
  const started = Date.now();
  const rows = db
    .prepare(
      "SELECT chunk_id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance"
    )
    .all(Buffer.from(queryEmbedding.buffer), k) as { chunk_id: string; distance: number }[];
  logger.info(`sqlite-vec knn_search executed in ${Date.now() - started}ms`, { hits: rows.length });
  return rows;
}
