import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/db/knowledge";
import { queueIngestion } from "@/lib/knowledge/ingest";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ documents: listDocuments() });
}

export async function POST(req: NextRequest) {
  const { fileName, content, isBase64, confirmReingest } = await req.json();
  if (!fileName || typeof content !== "string") {
    return NextResponse.json(
      { status: 400, error: "bad_request", message: "fileName and content are required." },
      { status: 400 }
    );
  }
  const result = queueIngestion({ fileName, content, isBase64: !!isBase64 });
  if (result.duplicate && !confirmReingest) {
    return NextResponse.json({
      duplicate: true,
      documentId: result.duplicate.id,
      indexedAt: result.duplicate.indexedAt,
      message: `This document is already in the knowledge base (added ${new Date(result.duplicate.indexedAt).toLocaleDateString()}). Re-ingest to pick up changes?`,
    });
  }
  // 202 Accepted — the background worker processes the embedding job.
  return NextResponse.json({ documentId: result.documentId, jobId: result.jobId, status: "queued" }, { status: 202 });
}
