import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { ollamaProvider, getProviderByName, CHAT_PROVIDERS } from "@/lib/providers";
import { assessModelFit } from "@/lib/models/fit";
import { listHuggingfaceModels, HUGGINGFACE_CURATED } from "@/lib/providers/huggingface";
import { listLmStudioModels, detectLmStudio, LMSTUDIO_DOCS_URL } from "@/lib/providers/lmstudio";
import { getSettings } from "@/lib/db/queries";
import { getApiKey } from "@/lib/db/apikeys";

export const runtime = "nodejs";

const CLOUD_PROVIDERS = new Set(["openai", "anthropic", "groq", "openrouter", "gemini", "mindstudio"]);

/**
 * Annotate locally-served models with whether they actually fit in memory
 * right now. Selecting one that does not is what makes a chat hang instead of
 * answering, so the picker needs to say so up front.
 */
function withFit<T extends { name: string; size?: number }>(models: T[]) {
  const availableBytes = os.freemem();
  const totalBytes = os.totalmem();
  return models.map((m) => ({
    ...m,
    fit: assessModelFit({
      sizeBytes: m.size,
      availableBytes,
      totalBytes,
      modelName: m.name,
    }),
  }));
}

/**
 * GET /api/models?provider=ollama|huggingface|lmstudio|openai|anthropic|…
 *
 * Returns the installed/available models list for the selected provider plus a
 * provider-specific error if the runtime isn't reachable. The active model
 * pair (provider + active_model) is global in settings.
 */
export async function GET(req: NextRequest) {
  const provider = (new URL(req.url).searchParams.get("provider") || "ollama").toLowerCase();
  const settings = getSettings();
  const active = settings.active_model;
  const activeProvider = settings.provider;

  if (provider === "huggingface") {
    const models = await listHuggingfaceModels();
    return NextResponse.json({
      provider,
      models,
      active,
      active_provider: activeProvider,
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
        active_provider: activeProvider,
        error: `Could not reach LM Studio. Start it and enable the local server. (${det.error})`,
        docs_url: LMSTUDIO_DOCS_URL,
      });
    }
    const models = await listLmStudioModels();
    return NextResponse.json({
      provider,
      models: withFit(models),
      active,
      active_provider: activeProvider,
      docs_url: LMSTUDIO_DOCS_URL,
    });
  }

  if (CLOUD_PROVIDERS.has(provider) || (CHAT_PROVIDERS as readonly string[]).includes(provider)) {
    if (CLOUD_PROVIDERS.has(provider) && !getApiKey(provider) && provider !== "ollama") {
      return NextResponse.json({
        provider,
        models: [],
        active,
        active_provider: activeProvider,
        error: `No API key saved for ${provider}. Add one in Settings → Providers.`,
        needs_key: true,
      });
    }
    try {
      const models = await getProviderByName(provider).getModels();
      // Cloud models run on someone else's hardware, so a local memory check
      // is meaningless there; locally-served ones need it.
      const isLocal = !CLOUD_PROVIDERS.has(provider);
      return NextResponse.json({
        provider,
        models: isLocal ? withFit(models) : models,
        active,
        active_provider: activeProvider,
      });
    } catch (e: any) {
      return NextResponse.json({
        provider,
        models: [],
        active,
        active_provider: activeProvider,
        error: e?.message || `Could not list models for ${provider}`,
      });
    }
  }

  // default: ollama
  try {
    const models = await ollamaProvider.getModels();
    return NextResponse.json({
      provider: "ollama",
      models: withFit(models),
      active,
      active_provider: activeProvider,
    });
  } catch {
    return NextResponse.json(
      {
        provider: "ollama",
        models: [],
        active,
        active_provider: activeProvider,
        error: "Could not reach Ollama. Is it running?",
      },
      { status: 200 }
    );
  }
}
