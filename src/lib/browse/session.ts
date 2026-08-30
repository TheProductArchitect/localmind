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
import { glidePointerTo, showAgentCue } from "./agent-overlay";
import { clearAgentActivity, recordAgentActivity } from "./agent-activity";

export const BROWSE_VIEWPORT = { width: 1280, height: 800 };
const IDLE_TTL_MS = 45 * 60 * 1000;

/** One interactive element the agent can address by index. */
export type BrowseElement = {
  index: number;
  tag: string;
  type: string;
  label: string;
  x: number;
  y: number;
  box: { x: number; y: number; width: number; height: number };
};

type BrowseSession = {
  id: string;
  page: Page;
  lastUsed: number;
  linkedConversations: Set<string>;
  /** Last element map handed to the agent, addressed by `click_index`. */
  elements?: BrowseElement[];
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
  // Drop any previous link so switching to another granted tab (or none)
  // can't leave the agent acting on a stale session.
  const prev = conversationLinks.get(conversationId);
  if (prev && prev !== sessionId) {
    sessions.get(prev)?.linkedConversations.delete(conversationId);
  }
  s.linkedConversations.add(conversationId);
  conversationLinks.set(conversationId, sessionId);
}

/** Clear the conversation→session link (e.g. when the Sora panel has no grant). */
export function unlinkBrowseSession(conversationId: string): void {
  const id = conversationLinks.get(conversationId);
  if (!id) return;
  conversationLinks.delete(conversationId);
  sessions.get(id)?.linkedConversations.delete(conversationId);
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

/** Return existing session, or create only when sessionId is absent/null.
 *  A non-empty unknown id means the session expired — do NOT spawn a blank page. */
export async function ensureBrowseSession(sessionId?: string | null): Promise<string> {
  if (sessionId && sessions.has(sessionId)) return sessionId;
  if (sessionId) {
    throw Object.assign(new Error("Browse session expired. Reload /browse and try again."), {
      code: "SESSION_EXPIRED",
    });
  }
  return createBrowseSession();
}

export async function closeBrowseSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  for (const cid of s.linkedConversations) conversationLinks.delete(cid);
  // App tabs belong to the user — detach only, never close their tab. Take the
  // agent's overlay with us so a revoked tab shows no lingering Sora pointer.
  if (s.kind === "apptab") {
    await showAgentCue(s.page, { kind: "clear" });
  } else {
    try { await s.page.close(); } catch {}
  }
  clearAgentActivity(id);
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

  let host = u;
  try { host = new URL(u).host; } catch { /* keep full url */ }
  await showAgentCue(s.page, { kind: "status", label: `opening ${host}` });

  try {
    await s.page.goto(u, { waitUntil: "domcontentloaded", timeout: 60_000 });
    touch(s);
    s.elements = undefined;
    recordAgentActivity({ sessionId: sessionId, action: "navigate", detail: host, ok: true });
    await showAgentCue(s.page, { kind: "status", label: `opened ${host}` });
    return { ok: true };
  } catch (e: any) {
    recordAgentActivity({ sessionId, action: "navigate", detail: host, ok: false });
    return { ok: false, error: e?.message || "Navigation failed." };
  }
}

export type BrowseAction =
  | { type: "click"; x: number; y: number }
  | { type: "click_index"; index: number }
  | { type: "click_text"; text: string }
  | { type: "type"; text: string }
  | { type: "scroll"; deltaY: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "press"; key: string };

const ELEMENT_SCAN_SCRIPT = `() => {
  const selector = [
    "a[href]", "button", "input", "select", "textarea",
    "[role=button]", "[role=link]", "[role=textbox]", "[role=checkbox]",
    "[contenteditable=true]", "[onclick]"
  ].join(",");
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.right < 0) continue;
    if (r.top > window.innerHeight || r.left > window.innerWidth) continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const raw =
      el.getAttribute("aria-label") ||
      (el.innerText || "") ||
      el.value ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      "";
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      label: String(raw).replace(/\\s+/g, " ").trim().slice(0, 80),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    });
    if (out.length >= 60) break;
  }
  return out;
}`;

/**
 * Index the interactive elements currently in view. Coordinate guessing is the
 * main reason agents misclick, so the agent gets a numbered list it can act on
 * via `click_index`.
 */
export async function browseElements(sessionId: string): Promise<BrowseElement[]> {
  const s = sessions.get(sessionId);
  if (!s) return [];
  const url = s.page.url();
  if (url && url !== "about:blank") {
    const access = checkWebAccess(url);
    if (!access.ok) return [];
  }
  const raw = await s.page
    .evaluate(ELEMENT_SCAN_SCRIPT)
    .catch(() => [] as Omit<BrowseElement, "index">[]);
  const list = (raw as Omit<BrowseElement, "index">[]).map((e, i) => ({ ...e, index: i + 1 }));
  s.elements = list;
  touch(s);
  return list;
}

/** Human-readable element map for the agent's tool output. */
export function formatBrowseElements(list: BrowseElement[]): string {
  if (list.length === 0) return "No interactive elements found in view.";
  return list
    .map((e) => {
      const kind = e.type ? `${e.tag}:${e.type}` : e.tag;
      return `[${e.index}] ${kind} "${e.label || "(no label)"}" @ ${e.x},${e.y}`;
    })
    .join("\n");
}

/** Pick the element the agent means by visible text (exact wins over partial). */
export function matchElementByText(
  list: BrowseElement[],
  text: string
): BrowseElement | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const exact = list.find((e) => e.label.toLowerCase() === needle);
  if (exact) return exact;
  const starts = list.find((e) => e.label.toLowerCase().startsWith(needle));
  if (starts) return starts;
  return list.find((e) => e.label.toLowerCase().includes(needle)) ?? null;
}

function describeElement(e: BrowseElement): string {
  return e.label || `${e.tag} at ${e.x},${e.y}`;
}

export async function browseAction(sessionId: string, action: BrowseAction): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, error: "Browse session not found. Reload /browse and try again." };
  const { page } = s;

  // Re-check web access on the *current* URL — a granted tab can be navigated
  // (by the user or via click) onto a sensitive domain after attach.
  const beforeUrl = page.url();
  if (beforeUrl && beforeUrl !== "about:blank") {
    const access = checkWebAccess(beforeUrl);
    if (!access.ok) return { ok: false, error: access.reason };
  }

  /** Show, then do: the user sees the pointer land before the page reacts. */
  const clickAt = async (x: number, y: number, label: string, target?: BrowseElement) => {
    if (target) {
      await showAgentCue(page, { ...target.box, kind: "box", label: `clicking ${label}` });
    }
    await showAgentCue(page, { kind: "move", x, y, label: `clicking ${label}` });
    await glidePointerTo(page, x, y);
    await showAgentCue(page, { kind: "click", x, y, label: `clicking ${label}` });
    await page.mouse.click(x, y);
  };

  try {
    let detail = "";
    switch (action.type) {
      case "click":
        detail = `${action.x},${action.y}`;
        await clickAt(action.x, action.y, detail);
        break;
      case "click_index": {
        const list = s.elements?.length ? s.elements : await browseElements(sessionId);
        const target = list.find((e) => e.index === action.index);
        if (!target) {
          return {
            ok: false,
            error: `No element [${action.index}] in view. Run the elements operation again — the page may have changed.`,
          };
        }
        detail = describeElement(target);
        await clickAt(target.x, target.y, detail, target);
        break;
      }
      case "click_text": {
        const list = s.elements?.length ? s.elements : await browseElements(sessionId);
        const target = matchElementByText(list, action.text);
        if (!target) {
          return { ok: false, error: `No clickable element matching "${action.text}" in view.` };
        }
        detail = describeElement(target);
        await clickAt(target.x, target.y, detail, target);
        break;
      }
      case "type":
        detail = `${action.text.length} chars`;
        await showAgentCue(page, { kind: "status", label: "typing" });
        await page.keyboard.type(action.text);
        break;
      case "scroll":
        detail = `${action.deltaY}px`;
        await showAgentCue(page, { kind: "status", label: "scrolling" });
        await page.mouse.wheel(0, action.deltaY);
        break;
      case "back":
        await showAgentCue(page, { kind: "status", label: "going back" });
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        break;
      case "forward":
        await showAgentCue(page, { kind: "status", label: "going forward" });
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        break;
      case "press":
        detail = action.key;
        await showAgentCue(page, { kind: "status", label: `pressing ${action.key}` });
        await page.keyboard.press(action.key);
        break;
    }
    const afterUrl = page.url();
    if (afterUrl && afterUrl !== "about:blank") {
      const access = checkWebAccess(afterUrl);
      if (!access.ok) return { ok: false, error: access.reason };
    }
    touch(s);
    // The DOM moved under any coordinates we handed out; force a rescan.
    if (action.type !== "type") s.elements = undefined;
    recordAgentActivity({ sessionId, action: action.type, detail, ok: true });
    return { ok: true };
  } catch (e: any) {
    recordAgentActivity({ sessionId, action: action.type, detail: "", ok: false });
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
  // Same gate as navigate: if the user (or a click) moved a granted tab onto
  // a sensitive/blocked domain, refuse to return page content.
  if (url && url !== "about:blank") {
    const access = checkWebAccess(url);
    if (!access.ok) {
      return {
        sessionId,
        url,
        title: "",
        screenshotBase64: "",
        text: `[Blocked] ${access.reason}`,
        viewport: BROWSE_VIEWPORT,
      };
    }
  }
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
Use \`browse_session\` to act on this page when they ask. To click something, call
\`elements\` first for a numbered list of the controls in view, then \`click_index\`;
fall back to \`click_text\` or raw \`click\` coordinates only if that fails. The user
watches your pointer and clicks on the page, so act one step at a time.
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
