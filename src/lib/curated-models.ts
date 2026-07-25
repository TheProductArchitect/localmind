export const CURATED_MODELS = [
  { name: "llama3.2:3b", description: "Good all-rounder, runs well on 8GB", ram: "8GB", size: "2.0 GB" },
  { name: "llama3.1:8b", description: "Strong general model, needs 16GB", ram: "16GB", size: "4.7 GB" },
  { name: "qwen2.5-coder:7b", description: "Great at coding, needs 16GB", ram: "16GB", size: "4.7 GB" },
  { name: "phi3.5:3.8b", description: "Fast and compact, runs on 8GB", ram: "8GB", size: "2.2 GB" },
  { name: "mistral:7b", description: "Reliable mid-size model, 16GB recommended", ram: "16GB", size: "4.1 GB" },
];

/** Normalize Ollama tags so `llama3.2` and `llama3.2:latest` match. */
export function modelTagsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const norm = (s: string) => (s.endsWith(":latest") ? s.slice(0, -":latest".length) : s);
  return norm(a) === norm(b);
}

export function isLikelyEmbeddingModel(m: { name: string; family?: string }): boolean {
  const n = m.name.toLowerCase();
  const f = (m.family || "").toLowerCase();
  return n.includes("embed") || f.includes("bert") || f === "nomic-bert";
}

/** Prefer a curated chat model if installed; otherwise the most recently modified chat model. */
export function pickPreferredOllamaModel(
  installed: { name: string; family?: string; modified?: string }[]
): string | null {
  const chat = installed.filter((m) => !isLikelyEmbeddingModel(m));
  if (!chat.length) return null;
  for (const c of CURATED_MODELS) {
    const hit = chat.find((m) => modelTagsMatch(m.name, c.name));
    if (hit) return hit.name;
  }
  return [...chat].sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")))[0]
    ?.name ?? null;
}
