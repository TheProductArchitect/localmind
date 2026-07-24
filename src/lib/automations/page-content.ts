import { createHash } from "crypto";
import { checkWebAccess } from "../agent/web-guard";
import { resolveSecureWebpageReader } from "../tools/read-secure-webpage";

export type PageContentConfig = {
  url: string;
  selector?: string;
  hash?: string | null;
};

/** Normalize page text for stable hashing (whitespace collapse). */
export function normalizePageText(text: string, selector?: string): string {
  let t = String(text || "");
  // Soft selector: if the markdown contains a heading matching the selector, prefer that section.
  if (selector && selector !== "main") {
    const re = new RegExp(`(^|\\n)#+\\s*${escapeRegExp(selector)}[^\\n]*\\n([\\s\\S]*?)(?=\\n#+\\s|$)`, "i");
    const m = t.match(re);
    if (m) t = m[2] || t;
  }
  return t.replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hashPageText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Pure transition helper for page_content_change monitors.
 * First seed (no prior hash) never triggers; later changes do.
 */
export function pageContentChangeResult(
  previousHash: string | null | undefined,
  nextHash: string
): { triggered: boolean; seeded: boolean } {
  if (!previousHash) return { triggered: false, seeded: true };
  return { triggered: previousHash !== nextHash, seeded: false };
}

/**
 * Fetch page text via Secure Browser (web-guard enforced). Returns normalized
 * text + hash, or an error detail string.
 */
export async function fetchPageContentHash(
  cfg: PageContentConfig
): Promise<{ ok: true; hash: string; detail: string } | { ok: false; detail: string }> {
  const url = String(cfg.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, detail: "invalid url" };
  }
  const access = checkWebAccess(url);
  if (!access.ok) {
    return { ok: false, detail: access.reason || "web access denied" };
  }
  const reader = await resolveSecureWebpageReader();
  if (!reader) {
    return { ok: false, detail: "secure browser offline" };
  }
  const result = await reader.execute(
    { url, fresh: true },
    { conversationId: "monitor-page-content", approvedDirs: [] }
  );
  if (!result.ok || /^\s*\[ERROR\]/i.test(result.output || "")) {
    return { ok: false, detail: result.summary || result.output?.slice(0, 200) || "fetch failed" };
  }
  const normalized = normalizePageText(result.output, cfg.selector);
  const hash = hashPageText(normalized);
  return { ok: true, hash, detail: `hash ${hash.slice(0, 12)}… (${normalized.length} chars)` };
}
