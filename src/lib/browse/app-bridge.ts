/**
 * App-tab bridge — phase 3 of the agentic browser.
 *
 * Connects Playwright over CDP to the Electron shell's Chromium
 * (127.0.0.1:9223, opened by electron/main.js) and registers a GRANTED tab
 * as a browse session. From there the entire existing surface — the
 * `browse_session` tool, navigate/action/snapshot, the chat context prefix —
 * operates on the tab the user is looking at. Sora's hands on the page the
 * user's eyes are on.
 *
 * Access model (Nova's layers, applied to app tabs):
 *   - Nothing is attachable until the user grants THAT tab (UI toggle →
 *     POST /api/browse/app-tab). No standing access.
 *   - The grant is checked against web-guard at attach time and every
 *     navigation the agent performs re-checks (browseNavigate already does).
 *   - Revoke = session removed + CDP detach. The page is never closed by us.
 *   - Every attach/revoke is a security event; page reads audit as usual.
 */
import { chromium, type Browser, type Page } from "playwright";
import { registerExternalPage, closeBrowseSession, getBrowseSession } from "./session";
import { checkWebAccess } from "../agent/web-guard";
import { logSecurityEvent } from "../db/jobs";

const CDP_URL = `http://127.0.0.1:${process.env.LM_CDP_PORT || 9223}`;

let cdpBrowser: Browser | null = null;

async function getCdpBrowser(): Promise<Browser> {
  if (cdpBrowser && cdpBrowser.isConnected()) return cdpBrowser;
  cdpBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 5_000 });
  cdpBrowser.on("disconnected", () => { cdpBrowser = null; });
  return cdpBrowser;
}

/** Find the Playwright Page whose CDP targetId matches. */
async function findPageByTargetId(targetId: string): Promise<Page | null> {
  const browser = await getCdpBrowser();
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        const cdp = await context.newCDPSession(page);
        const info = (await cdp.send("Target.getTargetInfo")) as { targetInfo?: { targetId?: string } };
        await cdp.detach().catch(() => {});
        if (info?.targetInfo?.targetId === targetId) return page;
      } catch {
        // Page may have closed mid-scan; keep looking.
      }
    }
  }
  return null;
}

export function appTabSessionId(targetId: string): string {
  return `apptab-${targetId}`;
}

export async function grantAppTab(targetId: string): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  if (!/^[A-F0-9]{8,64}$/i.test(targetId)) {
    return { ok: false, error: "Invalid tab target id." };
  }
  let page: Page | null;
  try {
    page = await findPageByTargetId(targetId);
  } catch (e: any) {
    return {
      ok: false,
      error:
        "Could not reach the app's browser bridge. Is LocalMind running as the desktop app? " +
        `(${e?.message || "CDP connect failed"})`,
    };
  }
  if (!page) return { ok: false, error: "Tab not found — it may have been closed." };

  // Web-guard gate at attach: a tab already sitting on a blocked/sensitive
  // domain can't be granted (matches Layer 1/2 semantics). about:blank and
  // fresh tabs are fine.
  const url = page.url();
  if (url && url !== "about:blank") {
    const access = checkWebAccess(url);
    if (!access.ok) return { ok: false, error: access.reason };
  }

  const sessionId = registerExternalPage(appTabSessionId(targetId), page);
  logSecurityEvent("app_tab_granted", `${sessionId} @ ${url || "about:blank"}`);
  return { ok: true, sessionId };
}

export async function revokeAppTab(targetId: string): Promise<void> {
  const sessionId = appTabSessionId(targetId);
  if (getBrowseSession(sessionId)) {
    await closeBrowseSession(sessionId); // apptab kind → detach only
    logSecurityEvent("app_tab_revoked", sessionId);
  }
}
