import { NextRequest, NextResponse } from "next/server";
import { modelSupportsVisionSync, probeOllamaVision } from "@/lib/models/vision";

export const runtime = "nodejs";

/**
 * GET /api/models/capabilities?model=…&provider=ollama
 * Returns whether the model accepts multimodal (image) input.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const model = (url.searchParams.get("model") || "").trim();
  const provider = (url.searchParams.get("provider") || "ollama").toLowerCase();
  if (!model) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  let vision = modelSupportsVisionSync({ name: model });
  if (provider === "ollama") {
    vision = await probeOllamaVision(model);
  } else if (["openai", "anthropic", "gemini", "openrouter", "groq"].includes(provider)) {
    // Cloud chat models in LocalMind's curated set are generally multimodal
    // for modern Claude / GPT-4o / Gemini; keep the name heuristic.
    vision = modelSupportsVisionSync({ name: model });
  }

  return NextResponse.json({
    model,
    provider,
    vision,
    multimodal: vision,
    accepts: vision ? ["image", "pdf", "docx", "text"] : [],
  });
}
