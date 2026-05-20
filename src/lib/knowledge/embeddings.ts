const HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
export const EMBED_MODEL = process.env.LOCALMIND_EMBED_MODEL || "nomic-embed-text";

export async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await fetch(`${HOST}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { embedding?: number[] };
    return j.embedding || null;
  } catch {
    return null;
  }
}

export function floatsToBlob(v: number[]): Buffer {
  const arr = new Float32Array(v);
  return Buffer.from(arr.buffer);
}

export function blobToFloats(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
