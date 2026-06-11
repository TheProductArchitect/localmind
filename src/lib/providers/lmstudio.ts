/**
 * LM Studio integration.
 *
 * LM Studio exposes an OpenAI-compatible server (default http://localhost:1234)
 * once the user starts it from the desktop app. Model downloads happen inside
 * LM Studio itself — there's no external API for that — so LocalMind's role is
 * to detect the running instance, list whatever models the user has loaded,
 * and let them pick one as the active model. Chat flows through the existing
 * openai-compatible provider with LM Studio's base URL.
 */

const LMSTUDIO_HOST = process.env.LMSTUDIO_HOST || "http://localhost:1234";

export type LmStudioModel = {
  name: string;
  family?: string;
  size?: number;
  modified?: string;
};

export async function detectLmStudio(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${LMSTUDIO_HOST}/v1/models`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || `Cannot reach LM Studio at ${LMSTUDIO_HOST}` };
  }
}

export async function listLmStudioModels(): Promise<LmStudioModel[]> {
  const r = await fetch(`${LMSTUDIO_HOST}/v1/models`, { headers: { accept: "application/json" } });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: Array<{ id: string }> };
  return (j.data || []).map((m) => ({ name: m.id, family: "lmstudio" }));
}

export const LMSTUDIO_DOCS_URL = "https://lmstudio.ai/docs/local-server";
