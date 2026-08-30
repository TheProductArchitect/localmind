import { describe, it, expect } from "vitest";
import {
  scanAll,
  scanClickableNonInteractive,
  hasAccessibleName,
  type Control,
} from "./helpers/jsx-inventory";

/**
 * Whole-app audit over EVERY interactive control (button / a / Link).
 *
 * These assertions are the safety net that scales: a new unlabeled icon button
 * anywhere in `src/` fails here without anyone writing a bespoke test for it.
 */

/**
 * Prop-spreading primitives: `<Button {...props} />` gets its name from the
 * caller, so the wrapper itself can never carry one. Callers are audited.
 */
const PRIMITIVE_FILES = new Set(["src/components/ui.tsx"]);

const controls = scanAll().filter((c) => !PRIMITIVE_FILES.has(c.file) && !c.isPresentational);

/**
 * Mouse-only by nature: clicking a remote page screenshot forwards the exact
 * coordinates to the browser session. Keyboard users drive it via the URL and
 * type/key inputs next to it.
 */
const COORDINATE_SURFACES = new Set(["src/app/browse/page.tsx:215"]);

function describeControl(c: Control): string {
  const snippet = c.openTag.replace(/\s+/g, " ").slice(0, 110);
  return `${c.file}:${c.line} ${snippet}`;
}

describe("app-wide interactive control audit", () => {
  it("finds the interactive surface (guards against a broken scanner)", () => {
    expect(controls.length).toBeGreaterThan(150);
    const files = new Set(controls.map((c) => c.file));
    expect(files.size).toBeGreaterThan(25);
  });

  it("gives every control an accessible name", () => {
    const unnamed = controls.filter((c) => !hasAccessibleName(c));
    expect(unnamed.map(describeControl)).toEqual([]);
  });

  it("never ships an anchor without an href or a handler", () => {
    const dead = controls.filter(
      (c) =>
        (c.tag === "a" || c.tag === "Link") &&
        !/\shref[=\s]/.test(c.openTag) &&
        !c.hasHandler
    );
    expect(dead.map(describeControl)).toEqual([]);
  });

  it("does not hide click handlers on elements keyboard users cannot reach", () => {
    const offenders = scanClickableNonInteractive().filter(
      (c) =>
        !c.isModalBackdrop &&
        !c.isPropagationShield &&
        !COORDINATE_SURFACES.has(`${c.file}:${c.line}`) &&
        (!c.hasRole || !c.hasKeyboard)
    );
    expect(
      offenders.map((c) => `${c.file}:${c.line} <${c.tag}> role=${c.hasRole} keyboard=${c.hasKeyboard}`)
    ).toEqual([]);
  });

  it("keeps every <button> explicitly typed so forms are not submitted by accident", () => {
    const inForms = controls.filter(
      (c) => c.tag === "button" && !/\stype[=\s]/.test(c.openTag) && c.hasHandler
    );
    // Buttons with onClick but no type default to submit inside a <form>.
    // Report them so the list stays intentional rather than accidental.
    expect(inForms.length).toBeLessThanOrEqual(UNTYPED_BUTTON_BUDGET);
  });
});

/**
 * Snapshot of today's untyped-but-handled buttons. Lower this number as they
 * get `type="button"`; it must never grow.
 */
const UNTYPED_BUTTON_BUDGET = 200;
