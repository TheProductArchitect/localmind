import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { listTsxFiles } from "./helpers/jsx-inventory";

/**
 * Structural rules that apply to every route and every dialog in the app.
 * These catch the class of bug that only shows up at runtime on one page —
 * a page that cannot render, a modal you cannot escape from, a client hook in
 * a server component.
 */

const APP_ROOT = path.resolve(__dirname, "../src/app");
const REPO_ROOT = path.resolve(__dirname, "..");

const pages = listTsxFiles(APP_ROOT)
  .filter((f) => path.basename(f) === "page.tsx")
  .map((f) => ({ file: path.relative(REPO_ROOT, f), src: fs.readFileSync(f, "utf8") }));

const CLIENT_HOOKS = [
  "useState",
  "useEffect",
  "useRef",
  "useCallback",
  "useMemo",
  "useRouter",
  "useSearchParams",
  "usePathname",
];

describe("page contract", () => {
  it("finds every route", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it("exports a default component from every page", () => {
    const missing = pages.filter((p) => !/export\s+default\s+/.test(p.src));
    expect(missing.map((p) => p.file)).toEqual([]);
  });

  it("marks pages that use client hooks as client components", () => {
    const bad = pages.filter(
      (p) =>
        CLIENT_HOOKS.some((h) => new RegExp(`\\b${h}\\s*[(<]`).test(p.src)) &&
        !/^["']use client["'];?/m.test(p.src)
    );
    expect(bad.map((p) => p.file)).toEqual([]);
  });

  it("wraps useSearchParams in a Suspense boundary", () => {
    // Next.js bails out of static rendering (and warns at build) when
    // useSearchParams is read outside Suspense.
    const bad = pages.filter(
      (p) => /useSearchParams\s*\(/.test(p.src) && !/<Suspense/.test(p.src)
    );
    expect(bad.map((p) => p.file)).toEqual([]);
  });
});

describe("dialog contract", () => {
  const dialogs = listTsxFiles()
    .map((f) => ({ file: path.relative(REPO_ROOT, f), src: fs.readFileSync(f, "utf8") }))
    .filter((f) => /aria-modal/.test(f.src));

  it("finds the app's modal surfaces", () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(4);
  });

  it("labels every modal", () => {
    const unlabeled = dialogs.filter(
      (d) => !/aria-label(?:ledby)?[=\s]/.test(d.src)
    );
    expect(unlabeled.map((d) => d.file)).toEqual([]);
  });

  it("lets the keyboard dismiss every modal", () => {
    // A mouse user can click the backdrop; a keyboard user needs Escape.
    const trapped = dialogs.filter((d) => !/"Escape"|'Escape'/.test(d.src));
    expect(trapped.map((d) => d.file)).toEqual([]);
  });
});
