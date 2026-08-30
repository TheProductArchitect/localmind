/**
 * Static JSX inventory — enumerates every interactive control in the app so a
 * test can assert invariants across ALL of them (not just the ones someone
 * remembered to write a test for).
 *
 * This is deliberately a lexical scan, not a full parser: it needs to survive
 * `.tsx` with styled-jsx template literals, nested generics and inline SVG,
 * and it only has to answer narrow questions ("does this control carry an
 * accessible name?"). Anything it cannot answer statically is reported as
 * `dynamic` so the caller decides how strict to be.
 */

import fs from "node:fs";
import path from "node:path";

export type Control = {
  file: string;
  tag: string;
  line: number;
  /** Raw opening tag, e.g. `<button onClick={x} aria-label="Send">`. */
  openTag: string;
  hasAriaLabel: boolean;
  hasTitle: boolean;
  /** Literal text found between the tags (icons stripped). */
  literalText: string;
  /** A `{expr}` child that most likely renders text (e.g. `{d.label}`). */
  hasDynamicText: boolean;
  hasHandler: boolean;
  isDisabledOnly: boolean;
  /** `aria-hidden` + `tabIndex={-1}`: decorative, its wrapper carries the name. */
  isPresentational: boolean;
};

const SRC_ROOT = path.resolve(__dirname, "../../src");

/**
 * Tags we treat as interactive. `Link` is next/link (renders an <a>) and
 * `Button` is the local primitive in `src/components/ui.tsx` (renders <button>).
 */
const INTERACTIVE_TAGS = ["button", "a", "Link", "Button"];

/**
 * Tags that are keyboard-operable on their own. Anything else carrying an
 * onClick needs an explicit role plus a keyboard path.
 */
const NATIVELY_INTERACTIVE = new Set([
  "button",
  "a",
  "Link",
  "Button",
  "input",
  "Input",
  "select",
  "Select",
  "textarea",
  "Textarea",
  "label",
  "Label",
  "summary",
  "option",
  "form",
]);

export function listTsxFiles(dir = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

/**
 * Walks forward from the `<` of an opening tag and returns the index just past
 * the `>` that closes it, tracking string and brace nesting so attributes like
 * `onClick={() => f(">")}` do not end the tag early.
 */
function endOfOpenTag(src: string, start: number): { end: number; selfClosing: boolean } | null {
  let i = start;
  let brace = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      brace += 1;
    } else if (ch === "}") {
      brace -= 1;
    } else if (ch === ">" && brace === 0) {
      const selfClosing = src[i - 1] === "/";
      return { end: i + 1, selfClosing };
    }
    i += 1;
  }
  return null;
}

/** Finds the matching `</tag>` for an already-opened element, honoring nesting. */
function endOfElement(src: string, tag: string, afterOpen: number): number {
  const open = new RegExp(`<${tag}(\\s|>|/>)`, "g");
  const close = new RegExp(`</${tag}\\s*>`, "g");
  let depth = 1;
  let i = afterOpen;
  while (i < src.length) {
    open.lastIndex = i;
    close.lastIndex = i;
    const nextOpen = open.exec(src);
    const nextClose = close.exec(src);
    if (!nextClose) return src.length;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      i = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose.index;
    i = nextClose.index + 1;
  }
  return src.length;
}

/** Removes nested JSX elements, leaving literal text and `{expr}` markers. */
function stripNestedTags(children: string): string {
  return children.replace(/<[^>]*>/g, " ");
}

function extractExpressions(children: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of children) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) buf = "";
      else buf += ch;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) out.push(buf);
      else buf += ch;
      continue;
    }
    if (depth > 0) buf += ch;
  }
  return out;
}

/**
 * True when a `{expr}` child plausibly renders user-visible text.
 * Filters out expressions that only render other elements or icons.
 */
function expressionLooksLikeText(expr: string): boolean {
  const e = expr.trim();
  if (!e) return false;
  // `{cond && <Icon />}` / map over elements -> not text on its own
  const rendersElementOnly = /^[^"'`]*<[A-Za-z]/.test(e) && !/["'`]/.test(e);
  if (rendersElementOnly) return false;
  // String literals, template literals, or identifiers/props like `d.label`
  if (/["'`]/.test(e)) return true;
  if (/\b[a-zA-Z_$][\w$]*(\.[\w$]+)*\b/.test(e)) return true;
  return false;
}

/** Returns the `{...}` body of a JSX attribute, or "" when absent. */
function extractAttrExpression(openTag: string, attr: string): string {
  const at = openTag.indexOf(`${attr}={`);
  if (at === -1) return "";
  let i = at + attr.length + 1;
  let depth = 0;
  let buf = "";
  for (; i < openTag.length; i += 1) {
    const ch = openTag[i];
    if (ch === "{") {
      depth += 1;
      if (depth === 1) continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    buf += ch;
  }
  return buf;
}

export function scanFile(file: string): Control[] {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.resolve(__dirname, "../.."), file);
  const controls: Control[] = [];

  for (const tag of INTERACTIVE_TAGS) {
    const opener = new RegExp(`<${tag}(?=[\\s/>])`, "g");
    let m: RegExpExecArray | null;
    while ((m = opener.exec(src))) {
      const bounds = endOfOpenTag(src, m.index);
      if (!bounds) continue;
      const openTag = src.slice(m.index, bounds.end);

      let children = "";
      if (!bounds.selfClosing) {
        const closeAt = endOfElement(src, tag, bounds.end);
        children = src.slice(bounds.end, closeAt);
      }

      const stripped = stripNestedTags(children);
      const expressions = extractExpressions(stripped);
      const literalText = stripped
        .replace(/\{[\s\S]*?\}/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      controls.push({
        file: rel,
        tag,
        line: src.slice(0, m.index).split("\n").length,
        openTag,
        hasAriaLabel: /\saria-label(?:ledby)?[=\s]/.test(openTag),
        hasTitle: /\stitle[=\s]/.test(openTag),
        literalText,
        hasDynamicText: expressions.some(expressionLooksLikeText),
        hasHandler: /\son(Click|Submit|Change|KeyDown|Pointer\w+)[=\s]/.test(openTag),
        isDisabledOnly: /\sdisabled\b/.test(openTag) && !/\son(Click|Submit)/.test(openTag),
        isPresentational:
          /\saria-hidden\b/.test(openTag) && /\stabIndex=\{-1\}/.test(openTag),
      });
    }
  }

  return controls.sort((a, b) => a.line - b.line);
}

export function scanAll(): Control[] {
  return listTsxFiles().flatMap(scanFile);
}

export type Clickable = {
  file: string;
  tag: string;
  line: number;
  openTag: string;
  hasRole: boolean;
  hasKeyboard: boolean;
  /** A dialog/overlay backdrop: click-outside-to-dismiss, Escape does the same. */
  isModalBackdrop: boolean;
  /** `onClick={(e) => e.stopPropagation()}` — a shield, not a control. */
  isPropagationShield: boolean;
};

/**
 * Every element that handles clicks but is not natively focusable — the classic
 * "div acting as a button" that mouse users can use and keyboard users cannot.
 */
export function scanClickableNonInteractive(): Clickable[] {
  const out: Clickable[] = [];
  for (const file of listTsxFiles()) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(path.resolve(__dirname, "../.."), file);
    const opener = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
    let m: RegExpExecArray | null;
    while ((m = opener.exec(src))) {
      const tag = m[1];
      if (NATIVELY_INTERACTIVE.has(tag)) continue;
      const bounds = endOfOpenTag(src, m.index);
      if (!bounds) continue;
      const openTag = src.slice(m.index, bounds.end);
      if (!/\sonClick[=\s]/.test(openTag)) continue;
      const onClick = extractAttrExpression(openTag, "onClick");
      out.push({
        file: rel,
        tag,
        line: src.slice(0, m.index).split("\n").length,
        openTag,
        hasRole: /\srole[=\s]/.test(openTag),
        hasKeyboard: /\s(onKeyDown|onKeyUp|onKeyPress|tabIndex)[=\s]/.test(openTag),
        isModalBackdrop: /\saria-modal[=\s]/.test(openTag) && /\srole[=\s]/.test(openTag),
        isPropagationShield: /^\([^)]*\)\s*=>\s*[a-zA-Z]+\.stopPropagation\(\)$/.test(
          onClick.trim()
        ),
      });
    }
  }
  return out;
}

/** A control is "named" if a screen reader can announce something for it. */
export function hasAccessibleName(c: Control): boolean {
  return c.hasAriaLabel || c.hasTitle || c.literalText.length > 0 || c.hasDynamicText;
}
