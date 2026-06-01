import { getConfigDb } from ".";

export type ModelContextSource = "hardcoded" | "reported" | "user-override";

export type ModelContextOverride = {
  model_name: string;
  context_window_tokens: number;
  source: ModelContextSource;
  updated_at: number;
};

// Hardcoded sizes for well-known Ollama models. Used when Ollama doesn't
// report a context size and the user hasn't set an override. Numbers are the
// vendor-stated default context windows.
const KNOWN: Record<string, number> = {
  "llama3.2": 131072,
  "llama3.2:1b": 131072,
  "llama3.2:3b": 131072,
  "llama3.1": 131072,
  "llama3.1:8b": 131072,
  "llama3.1:70b": 131072,
  "qwen2.5": 32768,
  "qwen2.5:7b": 32768,
  "qwen2.5:14b": 32768,
  "qwen2.5-coder": 32768,
  "gemma2": 8192,
  "gemma2:9b": 8192,
  "gemma2:27b": 8192,
  "mistral": 32768,
  "mistral:7b": 32768,
  "phi3": 4096,
  "phi3.5": 131072,
  "codellama": 16384,
  "deepseek-r1": 65536,
  "deepseek-r1:7b": 65536,
  "deepseek-r1:14b": 65536,
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function listOverrides(): ModelContextOverride[] {
  return getConfigDb()
    .prepare("SELECT * FROM model_context_overrides ORDER BY model_name")
    .all() as ModelContextOverride[];
}

export function getOverride(modelName: string): ModelContextOverride | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM model_context_overrides WHERE model_name=?")
      .get(modelName) as ModelContextOverride | undefined) || null
  );
}

export function setOverride(modelName: string, tokens: number): ModelContextOverride {
  const now = readNow();
  getConfigDb()
    .prepare(
      `INSERT INTO model_context_overrides (model_name, context_window_tokens, source, updated_at)
       VALUES (?,?, 'user-override', ?)
       ON CONFLICT(model_name) DO UPDATE
         SET context_window_tokens=excluded.context_window_tokens,
             source='user-override',
             updated_at=excluded.updated_at`
    )
    .run(modelName, tokens, now);
  return getOverride(modelName)!;
}

export function deleteOverride(modelName: string): void {
  getConfigDb().prepare("DELETE FROM model_context_overrides WHERE model_name=?").run(modelName);
}

/**
 * Resolves the effective context window size for a model in priority order:
 *   1. user-override row in model_context_overrides
 *   2. value Ollama reported for the model (passed in by the caller)
 *   3. hardcoded lookup for well-known models
 *   4. 4096 default
 */
export function resolveContextWindow(
  modelName: string | null | undefined,
  ollamaReported?: number | null
): { tokens: number; source: ModelContextSource | "estimated" } {
  if (!modelName) return { tokens: 4096, source: "estimated" };
  const override = getOverride(modelName);
  if (override) return { tokens: override.context_window_tokens, source: "user-override" };
  if (ollamaReported && ollamaReported > 0) return { tokens: ollamaReported, source: "reported" };
  if (KNOWN[modelName]) return { tokens: KNOWN[modelName], source: "hardcoded" };
  // Last-effort: strip a tag (":7b") and try again.
  const bare = modelName.split(":")[0];
  if (KNOWN[bare]) return { tokens: KNOWN[bare], source: "hardcoded" };
  return { tokens: 4096, source: "estimated" };
}

export function getKnownContextWindow(modelName: string): number | null {
  if (KNOWN[modelName]) return KNOWN[modelName];
  const bare = modelName.split(":")[0];
  return KNOWN[bare] ?? null;
}
