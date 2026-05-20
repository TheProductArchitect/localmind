import {
  getAllChunksWithEmbeddings, getDocument, getChunksByIds,
} from "../db/knowledge";
import { getKnowledgeDb } from "../db";
import { isNativeVec, vecSearch } from "../db/vec";
import { embed, blobToFloats, cosineSimilarity } from "./embeddings";

export type SearchResult = {
  chunkId: string;
  documentId: string;
  documentName: string;
  text: string;
  score: number;
};

const MIN_SCORE = 0.5; // results below this similarity are not returned

// Semantic search — uses native sqlite-vec when available, JS cosine otherwise.
export async function semanticSearch(query: string, topK = 5): Promise<SearchResult[]> {
  const qvec = await embed(query);
  if (!qvec) return [];

  let scored: SearchResult[];

  if (isNativeVec()) {
    const hits = vecSearch(getKnowledgeDb(), new Float32Array(qvec), 10);
    const chunks = getChunksByIds(hits.map((h) => h.chunk_id));
    const byId = new Map(chunks.map((c) => [c.id, c]));
    scored = hits
      .map((h) => {
        const c = byId.get(h.chunk_id);
        if (!c) return null;
        return {
          chunkId: c.id,
          documentId: c.document_id,
          documentName: getDocument(c.document_id)?.file_name || "unknown",
          text: c.text.slice(0, 800),
          // sqlite-vec distance → similarity (cosine distance is 1 - similarity).
          score: 1 - h.distance,
        };
      })
      .filter(Boolean) as SearchResult[];
  } else {
    const chunks = getAllChunksWithEmbeddings();
    scored = [];
    for (const c of chunks) {
      if (!c.embedding) continue;
      const score = cosineSimilarity(qvec, blobToFloats(c.embedding as Buffer));
      scored.push({
        chunkId: c.id,
        documentId: c.document_id,
        documentName: getDocument(c.document_id)?.file_name || "unknown",
        text: c.text.slice(0, 800),
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
  }

  // Quality gate: drop weak matches.
  const relevant = scored.filter((r) => r.score >= MIN_SCORE);

  // Diversity: at most 2 chunks from any single document.
  const perDoc: Record<string, number> = {};
  const diverse: SearchResult[] = [];
  for (const r of relevant) {
    perDoc[r.documentId] = (perDoc[r.documentId] || 0) + 1;
    if (perDoc[r.documentId] <= 2) diverse.push(r);
    if (diverse.length >= topK) break;
  }
  return diverse;
}

export function isKnowledgeRelevant(question: string): boolean {
  return question.trim().length > 12;
}
