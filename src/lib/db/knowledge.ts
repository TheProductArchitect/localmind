import { nanoid } from "nanoid";
import { getKnowledgeDb } from ".";
import { isNativeVec, vecInsert } from "./vec";

export type Document = {
  id: string;
  file_path: string | null;
  file_name: string;
  file_type: string;
  last_indexed_at: number;
  chunk_count: number;
  status: string;
  error: string | null;
  file_hash: string | null;
};

export type Chunk = {
  id: string;
  document_id: string;
  text: string;
  embedding: Buffer | null;
  position: number;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  linked_note_ids: string;
  tags: string;
  source_conversation_id: string | null;
};

// ---- Documents ----
export function createDocument(opts: { file_path?: string; file_name: string; file_type: string; file_hash?: string }): Document {
  const id = nanoid(12);
  getKnowledgeDb()
    .prepare(
      "INSERT INTO documents (id,file_path,file_name,file_type,last_indexed_at,chunk_count,status,file_hash) VALUES (?,?,?,?,?,0,'pending',?)"
    )
    .run(id, opts.file_path ?? null, opts.file_name, opts.file_type, Date.now(), opts.file_hash ?? null);
  return getDocument(id)!;
}

export function getDocumentByHash(hash: string): Document | null {
  return (getKnowledgeDb().prepare("SELECT * FROM documents WHERE file_hash=?").get(hash) as Document) || null;
}

export function clearDocumentChunks(documentId: string) {
  getKnowledgeDb().prepare("DELETE FROM chunks WHERE document_id=?").run(documentId);
}

export function getDocument(id: string): Document | null {
  return (getKnowledgeDb().prepare("SELECT * FROM documents WHERE id=?").get(id) as Document) || null;
}

export function listDocuments(): Document[] {
  return getKnowledgeDb().prepare("SELECT * FROM documents ORDER BY last_indexed_at DESC").all() as Document[];
}

export function updateDocument(id: string, patch: Partial<Document>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getKnowledgeDb().prepare(`UPDATE documents SET ${set} WHERE id=@id`).run({ ...patch, id } as any);
}

export function deleteDocument(id: string) {
  const db = getKnowledgeDb();
  db.prepare("DELETE FROM chunks WHERE document_id=?").run(id);
  db.prepare("DELETE FROM documents WHERE id=?").run(id);
}

// ---- Chunks ----
export function insertChunk(documentId: string, text: string, position: number, embedding: Buffer | null) {
  const id = nanoid(14);
  const db = getKnowledgeDb();
  db.prepare("INSERT INTO chunks (id,document_id,text,embedding,position) VALUES (?,?,?,?,?)")
    .run(id, documentId, text, embedding, position);
  // Mirror into the native vec table when sqlite-vec is active.
  if (embedding && isNativeVec()) {
    vecInsert(db, id, new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4));
  }
}

export function getAllChunksWithEmbeddings(): Chunk[] {
  return getKnowledgeDb()
    .prepare("SELECT * FROM chunks WHERE embedding IS NOT NULL")
    .all() as Chunk[];
}

export function getChunksByIds(ids: string[]): Chunk[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getKnowledgeDb()
    .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
    .all(...ids) as Chunk[];
}

export function getChunksWithoutEmbeddings(limit = 32): Chunk[] {
  return getKnowledgeDb()
    .prepare("SELECT * FROM chunks WHERE embedding IS NULL LIMIT ?")
    .all(limit) as Chunk[];
}

export function setChunkEmbedding(id: string, embedding: Buffer) {
  getKnowledgeDb().prepare("UPDATE chunks SET embedding=? WHERE id=?").run(embedding, id);
}

// ---- Notes ----
export function listNotes(): Note[] {
  return getKnowledgeDb().prepare("SELECT * FROM notes ORDER BY updated_at DESC").all() as Note[];
}

export function getNote(id: string): Note | null {
  return (getKnowledgeDb().prepare("SELECT * FROM notes WHERE id=?").get(id) as Note) || null;
}

export function createNote(opts: { title: string; content?: string; tags?: string[]; source_conversation_id?: string }): Note {
  const id = nanoid(12);
  const now = Date.now();
  getKnowledgeDb()
    .prepare(
      "INSERT INTO notes (id,title,content,created_at,updated_at,linked_note_ids,tags,source_conversation_id) VALUES (?,?,?,?,?,'[]',?,?)"
    )
    .run(id, opts.title, opts.content || "", now, now, JSON.stringify(opts.tags || []), opts.source_conversation_id ?? null);
  return getNote(id)!;
}

export function updateNote(id: string, patch: { title?: string; content?: string; tags?: string[] }) {
  const p: any = { updated_at: Date.now() };
  if (patch.title !== undefined) p.title = patch.title;
  if (patch.content !== undefined) p.content = patch.content;
  if (patch.tags !== undefined) p.tags = JSON.stringify(patch.tags);
  const set = Object.keys(p).map((k) => `${k}=@${k}`).join(", ");
  getKnowledgeDb().prepare(`UPDATE notes SET ${set} WHERE id=@id`).run({ ...p, id });
}

export function deleteNote(id: string) {
  getKnowledgeDb().prepare("DELETE FROM notes WHERE id=?").run(id);
}
