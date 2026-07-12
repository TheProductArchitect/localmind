import { nanoid } from "nanoid";
import { getConfigDb } from ".";

// A typed relationship in the Brain's entity graph (§4.0). `source` records
// how the edge was learned so the User Context Graph (§12) can style
// unconfirmed inferences differently.
export type EdgeSource = "stated" | "inferred" | "imported";

export type BrainEdge = {
  id: string;
  src_entity: string;
  dst_entity: string;
  edge_type: string;
  source: EdgeSource;
  weight: number;
  created_at: number;
};

/** Normalize an entity reference to a stable slug used as its node id. */
export function slugifyEntity(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Insert or reinforce an edge. The UNIQUE(src,dst,type) constraint makes this
 *  idempotent; a repeat observation bumps the weight and can upgrade the
 *  source (inferred → stated). */
export function upsertEdge(o: {
  src: string;
  dst: string;
  type: string;
  source?: EdgeSource;
  weight?: number;
}): void {
  const src = slugifyEntity(o.src);
  const dst = slugifyEntity(o.dst);
  if (!src || !dst || src === dst) return;
  const db = getConfigDb();
  const existing = db
    .prepare("SELECT id, weight, source FROM brain_edges WHERE src_entity=? AND dst_entity=? AND edge_type=?")
    .get(src, dst, o.type) as { id: string; weight: number; source: EdgeSource } | undefined;
  if (existing) {
    // "stated" is the strongest source and is never downgraded.
    const nextSource: EdgeSource =
      existing.source === "stated" || o.source === "stated" ? "stated" : existing.source;
    db.prepare("UPDATE brain_edges SET weight=?, source=? WHERE id=?")
      .run(existing.weight + (o.weight ?? 1.0), nextSource, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO brain_edges (id, src_entity, dst_entity, edge_type, source, weight, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(nanoid(12), src, dst, o.type, o.source ?? "inferred", o.weight ?? 1.0, Date.now());
}

export function listEdges(entity?: string): BrainEdge[] {
  const db = getConfigDb();
  if (entity) {
    const slug = slugifyEntity(entity);
    return db
      .prepare("SELECT * FROM brain_edges WHERE src_entity=? OR dst_entity=? ORDER BY weight DESC")
      .all(slug, slug) as BrainEdge[];
  }
  return db.prepare("SELECT * FROM brain_edges ORDER BY weight DESC").all() as BrainEdge[];
}

export function deleteEdgesFor(entity: string): number {
  const slug = slugifyEntity(entity);
  const r = getConfigDb()
    .prepare("DELETE FROM brain_edges WHERE src_entity=? OR dst_entity=?")
    .run(slug, slug);
  return r.changes;
}

/** Extract `[[wikilink]]` references from markdown. Pure — no model calls. */
export function extractWikiLinks(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const name = m[1].split("|")[0].trim(); // support [[target|alias]]
    if (name) out.add(name);
  }
  return [...out];
}

/**
 * Zero-LLM write hook (§4.3 pattern 1): given a brain note's slug and its
 * markdown body, upsert a `mentioned_in` edge for every `[[entity]]` it links
 * to. Returns the number of edges written. Callers pass front-matter-derived
 * typed edges separately via upsertEdge().
 */
export function extractAndUpsertEdges(noteSlug: string, markdown: string, source: EdgeSource = "inferred"): number {
  const src = slugifyEntity(noteSlug);
  const links = extractWikiLinks(markdown);
  let n = 0;
  for (const target of links) {
    const before = n;
    upsertEdge({ src, dst: target, type: "mentioned_in", source });
    // upsertEdge is idempotent and doesn't report; count attempts that resolve
    // to a distinct target.
    if (slugifyEntity(target) && slugifyEntity(target) !== src) n = before + 1;
  }
  return n;
}
