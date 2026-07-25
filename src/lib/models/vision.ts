/**
 * Heuristics + optional Ollama `/api/show` probe for whether a chat model
 * accepts image (vision / multimodal) input.
 */

const VISION_NAME_RE =
  /vision|llava|bakllava|moondream|minicpm-v|qwen[\w.-]*vl|pixtral|gpt-4o|gpt-4\.1|gpt-4-turbo|claude-3|claude-4|claude-sonnet|claude-opus|gemini|gemma3|gemma4|\bvl\b/i;

export function modelNameSuggestsVision(name: string | null | undefined): boolean {
  if (!name) return false;
  return VISION_NAME_RE.test(name);
}

/** Sync check used by the UI when we have not yet probed the runtime. */
export function modelSupportsVisionSync(opts: {
  name?: string | null;
  family?: string | null;
  capabilities?: string[] | null;
}): boolean {
  const caps = opts.capabilities || [];
  if (caps.some((c) => /vision|image|multimodal/i.test(c))) return true;
  if (modelNameSuggestsVision(opts.name)) return true;
  if (opts.family && modelNameSuggestsVision(opts.family)) return true;
  return false;
}

/**
 * Ask Ollama whether a model advertises vision. Falls back to the name
 * heuristic when `/api/show` is unavailable or the model is not local.
 */
export async function probeOllamaVision(
  model: string,
  host = process.env.OLLAMA_HOST || "http://localhost:11434"
): Promise<boolean> {
  try {
    const r = await fetch(`${host}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return modelNameSuggestsVision(model);
    const j = (await r.json()) as {
      capabilities?: string[];
      details?: { family?: string; families?: string[] };
      model_info?: Record<string, unknown>;
    };
    if (Array.isArray(j.capabilities) && j.capabilities.length) {
      return modelSupportsVisionSync({ name: model, capabilities: j.capabilities, family: j.details?.family });
    }
    // Older Ollama: projector / clip keys in model_info imply vision.
    const info = j.model_info || {};
    if (Object.keys(info).some((k) => /projector|clip|vision/i.test(k))) return true;
    return modelSupportsVisionSync({ name: model, family: j.details?.family });
  } catch {
    return modelNameSuggestsVision(model);
  }
}
