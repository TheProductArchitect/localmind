/**
 * Context Broker (§7.3) — efficient local RAG.
 *
 * Instead of dumping whole files (memory, brain, history) into the model, the
 * broker retrieves only the top-relevant slices for the current turn and packs
 * them within a token budget. Everything is local: embeddings run through
 * Ollama (`nomic-embed-text`) and search runs over the local sqlite-vec index.
 *
 * The public surface is deliberately small:
 *   - retrieveContext()   — the async entry point used per-turn
 *   - packWithinBudget()  — pure, deterministic packing (unit-tested)
 *   - formatContextBlock() — renders the retrieved slice for the prompt
 */
import { semanticSearch } from "../knowledge/search";
import { listMemory } from "../db/queries";
import { getSettings } from "../db/queries";

export type ContextItem = { text: string; source: string; score: number };

export type BrokerResult = {
  items: ContextItem[];
  brief: string;
  /** Non-null when coverage is thin — surfaced so the model can say so. */
  gap: string | null;
  usedTokens: number;
  budgetTokens: number;
};

/** ~4 chars per token is the standard rough estimate for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Retrieval tuning is configuration, not magic: each value derives from the
// live context-window setting and is overridable via env so it can be tuned
// without a code change. Read at call time so overrides take effect immediately.
function num(envVar: string, fallback: number): number {
  const v = Number(process.env[envVar]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
/** Fraction of the model's context window the broker may spend on retrieved
 *  memory/brain context. Kept small so the turn stays lean. */
export function budgetFraction(): number {
  return num("LM_CONTEXT_BUDGET_FRACTION", 0.15);
}
export function floorBudgetTokens(): number {
  return num("LM_CONTEXT_FLOOR_TOKENS", 400);
}
export function defaultTopK(): number {
  return num("LM_CONTEXT_TOPK", 6);
}

export function defaultBudgetTokens(): number {
  const cw = Number(getSettings().context_window) || 0;
  const floor = floorBudgetTokens();
  if (cw > 0) return Math.max(floor, Math.floor(cw * budgetFraction()));
  return floor * 2;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/** Jaccard word-overlap similarity — a cheap, dependency-free near-duplicate
 *  check used at pack time (no embeddings needed once we already have text). */
function overlap(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const DUP_THRESHOLD = 0.8;

/**
 * Greedily pack the highest-scoring items into the token budget, skipping
 * near-duplicates. Pure and deterministic so it can be unit-tested without a DB.
 */
export function packWithinBudget(items: ContextItem[], budgetTokens: number): ContextItem[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept: ContextItem[] = [];
  let used = 0;
  for (const item of sorted) {
    const cost = estimateTokens(item.text);
    if (used + cost > budgetTokens) continue;
    if (kept.some((k) => overlap(k.text, item.text) >= DUP_THRESHOLD)) continue;
    kept.push(item);
    used += cost;
  }
  return kept;
}

/** Rank flat key/value memory against the query by keyword overlap. Small
 *  installs (few memories) pass through wholesale; large ones get ranked. */
function rankMemory(query: string, userId: string | undefined, limit: number): ContextItem[] {
  const mem = listMemory(userId);
  const q = tokenize(query);
  return mem
    .map((m) => {
      const text = `${m.key}: ${m.value}`;
      const t = tokenize(text);
      let inter = 0;
      for (const w of q) if (t.has(w)) inter++;
      // Baseline score keeps memory in contention even with no keyword hit, so
      // small installs still surface their (few) facts.
      const score = 0.5 + (q.size ? inter / q.size : 0) * 0.5;
      return { text, source: "memory", score } as ContextItem;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Retrieve the relevant context slice for a turn: knowledge-base chunks
 * (semantic) + relevant user memory (keyword-ranked), packed within budget.
 */
export async function retrieveContext(opts: {
  query: string;
  userId?: string;
  budgetTokens?: number;
  topK?: number;
}): Promise<BrokerResult> {
  const budgetTokens = opts.budgetTokens ?? defaultBudgetTokens();
  const topK = opts.topK ?? defaultTopK();

  const candidates: ContextItem[] = [];

  // Knowledge base / brain (semantic, already local + score-thresholded).
  try {
    const hits = await semanticSearch(opts.query, topK);
    for (const h of hits) {
      candidates.push({ text: h.text, source: `knowledge:${h.documentName}`, score: h.score });
    }
  } catch {
    // Embeddings unavailable (e.g. Ollama down) — degrade to memory only.
  }

  // User memory (keyword-ranked; capped so it can't crowd out knowledge).
  candidates.push(...rankMemory(opts.query, opts.userId, topK));

  const items = packWithinBudget(candidates, budgetTokens);
  const usedTokens = items.reduce((n, i) => n + estimateTokens(i.text), 0);
  const gap =
    items.length === 0
      ? "No stored memory or knowledge is relevant to this request yet."
      : null;

  return { items, brief: formatContextBlock(items, gap), gap, usedTokens, budgetTokens };
}

/** Render the retrieved slice as a cited prompt block. */
export function formatContextBlock(items: ContextItem[], gap: string | null): string {
  if (items.length === 0) {
    return `## Relevant context\n(${gap || "nothing relevant retrieved"})`;
  }
  const lines = items.map((i) => `- [${i.source}] ${i.text.replace(/\s+/g, " ").trim()}`);
  return `## Relevant context (retrieved, not exhaustive)\n${lines.join("\n")}`;
}
