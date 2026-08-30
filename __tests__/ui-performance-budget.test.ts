import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Latency budget guards for the app chrome.
 *
 * The UI target is sub-100ms for anything that is not an LLM call. Two changes
 * bought most of that back: dropping continuous `backdrop-filter` from surfaces
 * that are always on screen (it re-blurs every frame on Electron/NVIDIA), and
 * keeping the chat route's stylesheet out of the global bundle. Both are easy
 * to undo by accident, so they are pinned here.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** Chrome that is mounted on every route, i.e. blurred on every frame. */
const PERSISTENT_CHROME = [
  ".lm-composer",
  ".lm-conv",
  ".lm-surface-1",
  ".lm-surface-2",
  ".lm-confirm",
  ".lm-rail",
];

/** Splits a stylesheet into `selector { body }` pairs, ignoring at-rule heads. */
function ruleBlocks(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

describe("UI performance budget", () => {
  const globals = read("src/app/globals.css");
  const chat = read("src/styles/chat.css");

  it("keeps continuous blur off always-on-screen chrome", () => {
    const offenders: string[] = [];
    for (const css of [globals, chat]) {
      for (const rule of ruleBlocks(css)) {
        if (!/backdrop-filter\s*:\s*(?!none)/.test(rule.body)) continue;
        const hit = PERSISTENT_CHROME.find((sel) => rule.selector.includes(sel));
        if (hit) offenders.push(`${hit} in "${rule.selector}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("scopes the chat stylesheet to the chat route", () => {
    // Importing it globally would put the chat grid, composer and Sora rail
    // styles in front of every other page's first paint.
    expect(globals).not.toContain("chat.css");
    expect(read("src/app/layout.tsx")).not.toContain("chat.css");

    const importers = fs
      .readdirSync(path.join(REPO_ROOT, "src/app"), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
      .filter((e) => read(`src/app/${e.name}`).includes("chat.css"))
      .map((e) => e.name);
    expect(importers).toEqual(["page.tsx"]);
  });

  it("animates the click trace from static keyframes, not injected styles", () => {
    // Per-pulse <style> injection forced a style recalc on the click path.
    expect(globals).toContain("lm-edge-trace");
    // Match the JSX form, not the prose: the file's header mentions the tag.
    expect(read("src/components/edge-pulse.tsx")).not.toMatch(/<style jsx>\s*\{/);
  });

  it("defers decorative shell work past first paint", () => {
    const shell = read("src/components/deferred-shell.tsx");
    expect(shell).toContain("requestIdleCallback");
    expect(shell).toMatch(/EdgePulse|ReportImprovement/);
  });

  it("keeps animation and transition work on compositor-friendly properties", () => {
    // Transitioning layout properties (width/height/top/left) forces reflow on
    // every frame; transform/opacity stay on the compositor.
    const laggy: string[] = [];
    for (const rule of ruleBlocks(globals)) {
      const transition = rule.body.match(/transition\s*:\s*([^;]+)/)?.[1] ?? "";
      if (/\b(width|height|top|left|right|bottom|margin|padding)\b/.test(transition)) {
        laggy.push(`${rule.selector}: ${transition.trim()}`);
      }
    }
    expect(laggy).toEqual([]);
  });
});
