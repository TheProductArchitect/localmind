import crypto from "crypto";
import {
  createDocument, insertChunk, updateDocument, getDocument, clearDocumentChunks,
  getDocumentByHash,
} from "../db/knowledge";
import { enqueueJob } from "../db/jobs";
import { embed, floatsToBlob } from "./embeddings";
import { extractDocumentText } from "./parsers";
import { logger } from "../logger";

// Split into ~512-token chunks (~2000 chars) with 64-token (~256 char) overlap.
export function chunkText(text: string): string[] {
  const CHUNK = 2000;
  const OVERLAP = 256;
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK));
    i += CHUNK - OVERLAP;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

// Phase 1 (API route): record the document and queue an embedding job.
// Returns 202-style identifiers; the worker does the heavy lifting.
export function queueIngestion(opts: {
  fileName: string;
  content: string;
  isBase64: boolean;
  filePath?: string;
}): { documentId: string; jobId: string; duplicate?: { id: string; indexedAt: number } } {
  const hash = crypto.createHash("sha256").update(opts.content).digest("hex");
  const existing = getDocumentByHash(hash);
  const fileType = opts.fileName.toLowerCase().split(".").pop() || "txt";

  if (existing && existing.status === "indexed") {
    return {
      documentId: existing.id,
      jobId: "",
      duplicate: { id: existing.id, indexedAt: existing.last_indexed_at },
    };
  }

  const doc = existing || createDocument({ file_name: opts.fileName, file_type: fileType, file_path: opts.filePath, file_hash: hash });
  updateDocument(doc.id, { status: "pending", error: null });
  const jobId = enqueueJob("ingest", {
    documentId: doc.id,
    fileName: opts.fileName,
    content: opts.content,
    isBase64: opts.isBase64,
  });
  return { documentId: doc.id, jobId };
}

// Phase 2 (background worker): extract, chunk, embed, store.
export async function processIngestJob(
  payload: { documentId: string; fileName: string; content: string; isBase64: boolean },
  onProgress?: (done: number, total: number) => void
): Promise<{ chunkCount: number }> {
  const doc = getDocument(payload.documentId);
  if (!doc) throw new Error("Document no longer exists");
  updateDocument(doc.id, { status: "indexing" });
  try {
    const text = await extractDocumentText(payload.fileName, payload.content, payload.isBase64);
    if (text.trim().length < 100) {
      updateDocument(doc.id, { status: "failed", error: "Document appears to have no readable text." });
      return { chunkCount: 0 };
    }
    clearDocumentChunks(doc.id);
    const chunks = chunkText(text);
    onProgress?.(0, chunks.length);

    // Embed with a concurrency limit of 3, in batches of 50 with a pause.
    let done = 0;
    for (let batchStart = 0; batchStart < chunks.length; batchStart += 50) {
      const batch = chunks.slice(batchStart, batchStart + 50);
      for (let i = 0; i < batch.length; i += 3) {
        const slice = batch.slice(i, i + 3);
        const vecs = await Promise.all(slice.map((c) => embed(c)));
        slice.forEach((c, j) => {
          const idx = batchStart + i + j;
          insertChunk(doc.id, c, idx, vecs[j] ? floatsToBlob(vecs[j]!) : null);
        });
        done += slice.length;
        onProgress?.(done, chunks.length);
      }
      if (batchStart + 50 < chunks.length) await new Promise((r) => setTimeout(r, 2000));
    }

    updateDocument(doc.id, { chunk_count: chunks.length, status: "indexed", last_indexed_at: Date.now(), error: null });
    logger.info("document indexed", { document: payload.fileName, chunks: chunks.length });
    return { chunkCount: chunks.length };
  } catch (e: any) {
    updateDocument(doc.id, { status: "failed", error: e?.message || "ingestion failed" });
    logger.error("ingest failed", { document: payload.fileName, error: e?.message });
    throw e;
  }
}
