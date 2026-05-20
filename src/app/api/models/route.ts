import { NextResponse } from "next/server";
import { ollamaProvider } from "@/lib/providers";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  try {
    const models = await ollamaProvider.getModels();
    const s = getSettings();
    return NextResponse.json({ models, active: s.active_model });
  } catch {
    return NextResponse.json(
      { models: [], active: null, error: "Could not reach Ollama. Is it running?" },
      { status: 200 }
    );
  }
}
