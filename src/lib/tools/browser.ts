import type { Browser } from "playwright";
import type { Tool } from "./types";
import { logger } from "../logger";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  const { chromium } = await import("playwright");
  const wsEndpoint = process.env.PLAYWRIGHT_BROWSER_WS_ENDPOINT;
  browserInstance = wsEndpoint
    ? await chromium.connect(wsEndpoint)
    : await chromium.launch({ headless: true });
  logger.info("playwright browser launched");
  return browserInstance;
}

export async function closeBrowser() {
  try { await browserInstance?.close(); } catch {}
  browserInstance = null;
}

// Shut the shared browser down cleanly on process exit.
process.once("SIGTERM", () => { closeBrowser(); });
process.once("SIGINT", () => { closeBrowser(); });

export const browserTool: Tool = {
  actionType: "browser_automation",
  preview: (i) => `Open page in a real browser: ${i.url}`,
  definition: {
    name: "browser",
    description:
      "Open a web page in a real Chromium browser (renders JavaScript) and return its readable text content. Pass a URL.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  async execute(input) {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\//.test(url)) {
      return { ok: false, output: "A valid http(s) URL is required." };
    }
    let page;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

      // Readability-style extraction: prefer <article>/<main>, fall back to body.
      const result = await page.evaluate(() => {
        const title = document.title || "";
        const main =
          document.querySelector("article") || document.querySelector("main") || document.body;
        const byline =
          (document.querySelector('meta[name="author"]') as HTMLMetaElement)?.content || "";
        return { title, byline, text: (main as HTMLElement)?.innerText || "" };
      });

      const body = `Title: ${result.title}${result.byline ? `\nBy: ${result.byline}` : ""}\n\n${result.text.slice(0, 8000)}`;
      return { ok: true, output: body, summary: `read page ${url}` };
    } catch (e: any) {
      const msg = e?.message || "unknown";
      if (/Executable doesn't exist|playwright install/i.test(msg)) {
        return {
          ok: false,
          output: "The browser is not installed. Run: npx playwright install chromium",
          summary: "failed: browser not installed",
        };
      }
      return { ok: false, output: `Could not load the page: ${msg}`, summary: "failed" };
    } finally {
      try { await page?.close(); } catch {}
    }
  },
};
