/**
 * Knowledge sharing — federated search + fetch with per-document policy gates.
 *
 * Wraps the existing knowledge.db tables (documents, chunks, notes) and the
 * `knowledge_share_policy` table from V8. Designed so peers can run text
 * searches across what we've explicitly shared, without ever bulk-replicating
 * our knowledge base.
 *
 * Privacy model (V6 plan §9):
 *   - `private`           never exposed; default for everything not in the
 *                          policy table
 *   - `fleet-queryable`   peers can SEARCH and get snippets (≤300 chars) but
 *                          not full content; query terms are recorded in OUR
 *                          audit log
 *   - `fleet-readable`    peers can fetch full content by document id, AND
 *                          the doc shows up in fleet-queryable searches
 *
 * `granted_peers` is an allow-list; when empty, any paired peer can access
 * at the configured level.
 */

import { getKnowledgeDb } from ".";
import { peerCanAccessDocument, type KnowledgeSharePolicy } from "./fleet";

export type ShareableSnippet = {
  document_id: string;
  kind: "document" | "note";
  title: string;
  snippet: string;          // ≤300 chars, with the matching span if found
  score: number;             // simple match count for now; vector ranking lands in V6.6.1
  policy: KnowledgeSharePolicy;
};

export type ShareableContent = {
  document_id: string;
  kind: "document" | "note";
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

const MAX_SNIPPET_LEN = 300;
const MAX_QUERY_LEN = 500;
const MAX_RESULTS = 25;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

function buildSnippet(text: string, query: string): string {
  const lc = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lc.indexOf(q);
  if (idx === -1) return text.slice(0, MAX_SNIPPET_LEN);
  // Window the snippet around the match.
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + q.length + (MAX_SNIPPET_LEN - 80));
  let out = text.slice(start, end);
  if (start > 0) out = "…" + out;
  if (end < text.length) out = out + "…";
  return out;
}

function scoreText(text: string, query: string): number {
  const lc = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const i = lc.indexOf(q, from);
    if (i === -1) break;
    n++;
    from = i + q.length;
  }
  return n;
}

/**
 * Search across shareable documents + notes for a peer. Only items whose
 * policy allows the requesting peer to perform the minimum level get
 * considered.
 *
 *   - minimum 'fleet-queryable' → snippets only
 *   - minimum 'fleet-readable'  → snippets AND the doc is fetchable by id
 *
 * We always return snippets (not full text) here — callers fetch full content
 * explicitly via the fetch handler so it's a separate auditable event.
 */
export function searchShareable(args: {
  peer_node_id: string;
  query: string;
  limit?: number;
}): ShareableSnippet[] {
  const query = args.query.slice(0, MAX_QUERY_LEN).trim();
  if (!query) return [];
  const limit = Math.min(Math.max(args.limit ?? 10, 1), MAX_RESULTS);

  const db = getKnowledgeDb();
  const like = `%${escapeLike(query)}%`;

  // Note search — fast, single table. We fetch all candidate notes that match
  // textually, then filter by policy in JS (the policy table lives in
  // config.db, not knowledge.db, so we can't JOIN across DBs).
  const noteRows = db
    .prepare(
      "SELECT id, title, content FROM notes WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' LIMIT ?"
    )
    .all(like, like, limit * 4) as Array<{ id: string; title: string; content: string }>;

  // Document search — match against chunks (the indexed text), surface the
  // owning document for the policy check. Group by document so a doc with
  // many matching chunks only appears once but accumulates score.
  const chunkRows = db
    .prepare(
      `SELECT c.document_id, c.text, d.file_name
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.text LIKE ? ESCAPE '\\'
       LIMIT ?`
    )
    .all(like, limit * 4) as Array<{ document_id: string; text: string; file_name: string }>;

  const candidates: ShareableSnippet[] = [];

  for (const n of noteRows) {
    if (!peerCanAccessDocument(args.peer_node_id, n.id, "fleet-queryable")) continue;
    const policyRow = (db as unknown as { _q?: never }); void policyRow;
    const policy = policyFor(n.id);
    if (!policy) continue;
    candidates.push({
      document_id: n.id,
      kind: "note",
      title: n.title,
      snippet: buildSnippet(`${n.title}\n${n.content}`, query),
      score: scoreText(n.title, query) * 3 + scoreText(n.content, query),
      policy,
    });
  }

  // Group chunk hits by document_id.
  const docScore = new Map<string, { snippet: string; score: number; file_name: string }>();
  for (const c of chunkRows) {
    if (!peerCanAccessDocument(args.peer_node_id, c.document_id, "fleet-queryable")) continue;
    const cur = docScore.get(c.document_id);
    const s = scoreText(c.text, query);
    if (!cur) {
      docScore.set(c.document_id, { snippet: buildSnippet(c.text, query), score: s, file_name: c.file_name });
    } else {
      cur.score += s;
      // Prefer a snippet that actually contains the query.
      if (!cur.snippet.toLowerCase().includes(query.toLowerCase()) && s > 0) {
        cur.snippet = buildSnippet(c.text, query);
      }
    }
  }
  for (const [docId, info] of docScore) {
    const policy = policyFor(docId);
    if (!policy) continue;
    candidates.push({
      document_id: docId,
      kind: "document",
      title: info.file_name,
      snippet: info.snippet,
      score: info.score,
      policy,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

function policyFor(documentId: string): KnowledgeSharePolicy | null {
  // Cheap re-read; the peerCanAccessDocument call above already filtered, so
  // a row must exist with at least 'fleet-queryable'.
  const { getKnowledgePolicy } = require("./fleet") as typeof import("./fleet");
  const row = getKnowledgePolicy(documentId);
  return row ? (row.policy as KnowledgeSharePolicy) : null;
}

/**
 * Fetch full content for a peer. Only allowed if policy is `fleet-readable`
 * AND the peer is in the granted_peers list (or list is empty).
 */
export function fetchShareable(args: {
  peer_node_id: string;
  document_id: string;
}): { ok: true; content: ShareableContent } | { ok: false; reason: string } {
  if (!peerCanAccessDocument(args.peer_node_id, args.document_id, "fleet-readable")) {
    return { ok: false, reason: "Document is not fleet-readable for this peer." };
  }

  const db = getKnowledgeDb();
  // Try notes first (cheaper lookup).
  const note = db
    .prepare("SELECT id, title, content, tags, created_at, updated_at FROM notes WHERE id=?")
    .get(args.document_id) as
    | { id: string; title: string; content: string; tags: string; created_at: number; updated_at: number }
    | undefined;
  if (note) {
    return {
      ok: true,
      content: {
        document_id: note.id,
        kind: "note",
        title: note.title,
        content: note.content,
        metadata: {
          tags: safeParseArray(note.tags),
          created_at: note.created_at,
          updated_at: note.updated_at,
        },
      },
    };
  }

  // Document — concatenate its chunks in order.
  const doc = db
    .prepare("SELECT id, file_name, file_type, last_indexed_at, chunk_count FROM documents WHERE id=?")
    .get(args.document_id) as
    | { id: string; file_name: string; file_type: string; last_indexed_at: number; chunk_count: number }
    | undefined;
  if (!doc) return { ok: false, reason: "Document not found." };
  const chunks = db
    .prepare("SELECT text FROM chunks WHERE document_id=? ORDER BY position")
    .all(doc.id) as Array<{ text: string }>;
  return {
    ok: true,
    content: {
      document_id: doc.id,
      kind: "document",
      title: doc.file_name,
      content: chunks.map((c) => c.text).join("\n\n"),
      metadata: {
        file_type: doc.file_type,
        last_indexed_at: doc.last_indexed_at,
        chunk_count: doc.chunk_count,
      },
    },
  };
}

function safeParseArray(s: string): unknown[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
