/**
 * Interactive Browse sessions — persistent Playwright pages for /browse.
 * Sessions are created on demand (first navigate), not on page mount, so
 * React Strict Mode remounts don't instantly delete them.
 */
import type { Page } from "playwright";
import { nanoid } from "nanoid";
import "@/lib/playwright-path";
import { getBrowser } from "../tools/browser";
import { checkWebAccess, auditPageRead } from "../agent/web-guard";

export const BROWSE_VIEWPORT = { width: 1280, height: 800 };
const IDLE_TTL_MS = 45 * 60 * 1000;

type BrowseSession = {
  id: string;
  page: Page;
  lastUsed: number;
  linkedConversations: Set<string>;
  /**
   * "headless" — a page we launched; closing the session closes the page.
   * "apptab"   — a live tab in the Electron shell attached over CDP; the
   *              page belongs to the USER, so closing the session only
   *              detaches (never page.close()), and idle TTL leaves it alone.
   */
  kind: "headless" | "apptab";
};

const sessions = new Map<string, BrowseSession>();
const conversationLinks = new Map<string, string>();

function touch(s: BrowseSession) {
  s.lastUsed = Date.now();
}

export function getBrowseSession(id: string): BrowseSession | undefined {
  return sessions.get(id);
}

export function linkBrowseSession(conversationId: string, sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.linkedConversations.add(conversationId);
  conversationLinks.set(conversationId, sessionId);
}

export function getBrowseSessionForConversation(conversationId: string): BrowseSession | null {
  const id = conversationLinks.get(conversationId);
  return id ? sessions.get(id) ?? null : null;
}

export async function createBrowseSession(): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: BROWSE_VIEWPORT });
  const id = `browse-${nanoid(12)}`;
  sessions.set(id, { id, page, lastUsed: Date.now(), linkedConversations: new Set(), kind: "headless" });
  return id;
}

/**
 * Register a page we did NOT launch (an Electron app tab attached over CDP)
 * under a caller-chosen stable id. Idempotent — re-granting the same tab
 * reuses the session. The page is never closed by us.
 */
export function registerExternalPage(id: string, page: Page): string {
  const existing = sessions.get(id);
  if (existing) {
    existing.page = page;
    touch(existing);
    return id;
  }
  sessions.set(id, { id, page, lastUsed: Date.now(), linkedConversations: new Set(), kind: "apptab" });
  return id;
}

/** Return existing session or create a new one when id is missing/invalid. */
export async function ensureBrowseSession(sessionId?: string | null): Promise<string> {
  if (sessionId && sessions.has(sessionId)) return sessionId;
  return createBrowseSession();
}

export async function closeBrowseSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  for (const cid of s.linkedConversations) conversationLinks.delete(cid);
  // App tabs belong to the user — detach only, never close their tab.
  if (s.kind === "headless") {
    try { await s.page.close(); } catch {}
  }
  sessions.delete(id);
}

export async function browseNavigate(sessionId: string, url: string): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, error: "Browse session not found. Reload /browse and try again." };

  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;

  const access = checkWebAccess(u);
  if (!access.ok) return { ok: false, error: access.reason };
  auditPageRead("browse_session", u);

  try {
    await s.page.goto(u, { waitUntil: "domcontentloaded", timeout: 60_000 });
    touch(s);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Navigation failed." };
  }
}

export type BrowseAction =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "scroll"; deltaY: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "press"; key: string };

export async function browseAction(sessionId: string, action: BrowseAction): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, error: "Browse session not found. Reload /browse and try again." };
  const { page } = s;

  try {
    switch (action.type) {
      case "click":
        await page.mouse.click(action.x, action.y);
        break;
      case "type":
        await page.keyboard.type(action.text);
        break;
      case "scroll":
        await page.mouse.wheel(0, action.deltaY);
        break;
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        break;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        break;
      case "press":
        await page.keyboard.press(action.key);
        break;
    }
    touch(s);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Action failed." };
  }
}

export type BrowseSnapshot = {
  sessionId: string;
  url: string;
  title: string;
  screenshotBase64: string;
  text: string;
  viewport: typeof BROWSE_VIEWPORT;
};

export async function browseSnapshot(sessionId: string): Promise<BrowseSnapshot | null> {
  const s = sessions.get(sessionId);
  if (!s) return null;
  touch(s);

  const { page } = s;
  const url = page.url();
  const title = await page.title().catch(() => "");
  // Best-effort: an app tab that is hidden or not yet laid out (zero-size
  // WebContentsView) can't be captured — the textual context below is what
  // the agent actually reasons over, so degrade instead of failing.
  const screenshot = await page
    .screenshot({ type: "jpeg", quality: 72, fullPage: false })
    .catch(() => Buffer.alloc(0));
  const text = await page
    .evaluate(() => {
      const main = document.querySelector("article") || document.querySelector("main") || document.body;
      return ((main as HTMLElement)?.innerText || "").slice(0, 6000);
    })
    .catch(() => "");

  return {
    sessionId,
    url,
    title,
    screenshotBase64: screenshot.toString("base64"),
    text,
    viewport: BROWSE_VIEWPORT,
  };
}

export async function buildBrowseContextPrefix(sessionId: string): Promise<string> {
  const snap = await browseSnapshot(sessionId);
  if (!snap) {
    return `## Browse context\nThe user is in LocalMind Browse but the interactive session is unavailable.`;
  }
  const excerpt = snap.text.trim().slice(0, 2500);
  return `## Browse context
The user is browsing in LocalMind's interactive view (live Chromium). Session: \`${sessionId}\`.
Use \`browse_session\` to navigate, click, type, or snapshot this page when they ask you to act on what they see.
Current URL: ${snap.url}
Title: ${snap.title || "(untitled)"}
Visible text:
${excerpt || "(empty)"}`;
}

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      // Idle reaping is for headless pages we own. An app tab stays granted
      // until the user revokes it or closes the tab.
      if (s.kind === "headless" && now - s.lastUsed > IDLE_TTL_MS) {
        closeBrowseSession(id).catch(() => {});
      }
    }
  }, 5 * 60 * 1000).unref?.();
}
