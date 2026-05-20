// WCAG 2.1 AA audit. Requires the app running at $LOCALMIND_URL and a Chromium
// browser installed (npx playwright install chromium). Exits 1 on serious or
// critical violations.
const fs = require("fs");
const path = require("path");

const BASE = process.env.LOCALMIND_URL || "http://localhost:3000";
const PAGES = ["/", "/settings", "/audit", "/knowledge", "/permissions"];
const THEMES = ["light", "dark"];

(async () => {
  let chromium, AxeBuilder;
  try {
    ({ chromium } = require("playwright"));
    AxeBuilder = require("@axe-core/playwright").default;
  } catch {
    console.error("Playwright or @axe-core/playwright not installed. Run: npx playwright install chromium");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const report = [];
  let seriousOrCritical = 0;

  for (const route of PAGES) {
    for (const theme of THEMES) {
      const page = await browser.newPage();
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
        await page.evaluate((t) => {
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        for (const v of results.violations) {
          report.push({ route, theme, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length });
          if (v.impact === "serious" || v.impact === "critical") seriousOrCritical++;
        }
        console.log(`${route} [${theme}] — ${results.violations.length} violations`);
      } catch (e) {
        console.error(`${route} [${theme}] — audit error: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  fs.mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "reports", "a11y-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.length} total violations, ${seriousOrCritical} serious/critical.`);
  console.log("Report written to reports/a11y-report.json");
  process.exit(seriousOrCritical > 0 ? 1 : 0);
})();
