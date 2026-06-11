import { NextRequest, NextResponse } from "next/server";
import { ollamaProvider } from "@/lib/providers";
import { listHuggingfaceModels, HUGGINGFACE_CURATED } from "@/lib/providers/huggingface";
import { listLmStudioModels, detectLmStudio, LMSTUDIO_DOCS_URL } from "@/lib/providers/lmstudio";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * GET /api/models?provider=ollama|huggingface|lmstudio
 *
 * Returns the installed-models list for the selected provider plus a
 * provider-specific error if the runtime isn't reachable. The active model
 * is global (lives in settings) and applies regardless of which provider's
 * list it came from.
 */
export async function GET(req: NextRequest) {
  const provider = (new URL(req.url).searchParams.get("provider") || "ollama").toLowerCase();
  const active = getSettings().active_model;

  if (provider === "huggingface") {
    const models = await listHuggingfaceModels();
    return NextResponse.json({
      provider,
      models,
      active,
      catalogue: HUGGINGFACE_CURATED,
    });
  }
  if (provider === "lmstudio") {
    const det = await detectLmStudio();
    if (!det.ok) {
      return NextResponse.json({
        provider,
        models: [],
        active,
        error: `Could not reach LM Studio. Start it and enable the local server. (${det.error})`,
        docs_url: LMSTUDIO_DOCS_URL,
      });
    }
    const models = await listLmStudioModels();
    return NextResponse.json({ provider, models, active, docs_url: LMSTUDIO_DOCS_URL });
  }
  // default: ollama
  try {
    const models = await ollamaProvider.getModels();
    return NextResponse.json({ provider: "ollama", models, active });
  } catch {
    return NextResponse.json(
      { provider: "ollama", models: [], active, error: "Could not reach Ollama. Is it running?" },
      { status: 200 }
    );
  }
}
