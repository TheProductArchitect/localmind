import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";
import { getChunksWithoutEmbeddings, setChunkEmbedding } from "@/lib/db/knowledge";
import { embed, floatsToBlob } from "@/lib/knowledge/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

// Processes any document chunks that were saved without an embedding
// (e.g. ingested while Ollama was offline). Throttled per call.
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const pending = getChunksWithoutEmbeddings(16);
  let done = 0;
  for (const chunk of pending) {
    const vec = await embed(chunk.text);
    if (vec) { setChunkEmbedding(chunk.id, floatsToBlob(vec)); done++; }
  }
  return NextResponse.json({ processed: done, remaining: pending.length - done });
}
