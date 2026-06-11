#!/usr/bin/env node
/**
 * Next 15 codemod: { params }: { params: { X: T } }  →  promised params + await.
 *
 * Rewrites every route handler / page that destructures `params` (or
 * `searchParams`) from its second arg, turning the type into a Promise and
 * inserting an await at the top of the function body.
 *
 * Strategy: rename the destructured binding to `<name>Promise` (so existing
 * `params.X` references inside the body keep working unchanged after we
 * reassign `const params = await paramsPromise`).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "src", "app");

/** Walk the app dir, return every .ts/.tsx file. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Walk the string starting at the `{` that opens a type object, return the
 * index of the matching `}`. Naive brace counter — fine for type literals,
 * which are small and don't contain strings.
 */
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Re-wrap the inner type with Promise<...>. */
function promisify(inner) {
  // inner already includes the outer `{ ... }`.
  return `Promise<${inner}>`;
}

let totalFiles = 0;
let totalSites = 0;

for (const file of walk(ROOT)) {
  let src = fs.readFileSync(file, "utf8");
  const original = src;
  let touched = false;

  // We do up to two passes per binding name. Each pass finds ONE binding
  // signature and rewrites it. The regex matches:
  //
  //   { params } : { params : { ... }
  //   { params, searchParams } : { params : { ... }, searchParams : { ... } }
  //
  // For each binding name found, we:
  //   1. promisify its type
  //   2. rename the destructure to `${name}Promise`
  //   3. insert `const { ${name} } = await Promise.all([…])` at function body top
  //
  // Simpler approach: handle params and searchParams independently.

  for (const name of ["params", "searchParams"]) {
    // Find every `name: { …typeobj… }` inside a destructure type.
    // Match the start, then use matchBrace for correctness on nested braces.
    const headRe = new RegExp(`(\\b${name}\\s*:\\s*)\\{`, "g");
    let m;
    while ((m = headRe.exec(src)) !== null) {
      const openIdx = m.index + m[0].length - 1; // position of the `{`
      // Skip if already wrapped in Promise<…>
      // Heuristic: look back ~10 chars for "Promise<"
      const lookback = src.slice(Math.max(0, m.index - 12), m.index);
      if (lookback.includes("Promise<")) continue;

      const closeIdx = matchBrace(src, openIdx);
      if (closeIdx < 0) continue;
      const inner = src.slice(openIdx, closeIdx + 1); // `{ ... }`

      // Only rewrite when this looks like a route-handler / page binding —
      // i.e. it's preceded somewhere within ~120 chars by `{ <name>` or
      // `{ <name>,`. Avoid clobbering unrelated `params: { foo }` literals.
      const ctxBefore = src.slice(Math.max(0, m.index - 200), m.index);
      const looksLikeBinding =
        new RegExp(`\\{\\s*${name}\\s*[,}]`).test(ctxBefore) ||
        new RegExp(`,\\s*${name}\\s*[,}]`).test(ctxBefore);
      if (!looksLikeBinding) continue;

      const before = src.slice(0, openIdx);
      const after = src.slice(closeIdx + 1);
      src = before + promisify(inner) + after;
      touched = true;
      totalSites++;
      // Reset regex; we mutated the source.
      headRe.lastIndex = 0;
    }
  }

  if (!touched) continue;

  // Now insert the await renaming pass. We need to:
  //   - rename `{ params }` → `{ params: paramsPromise }` in destructure args
  //   - rename `{ searchParams }` → `{ searchParams: searchParamsPromise }`
  //   - inject `const params = await paramsPromise;` at function body top
  //
  // We detect "destructure args" by finding occurrences of `{ params }` or
  // `{ params, searchParams }` etc. immediately followed by `: {` (the type)
  // OR `:` then `Promise<`.

  for (const name of ["params", "searchParams"]) {
    // Match `{ ... name ... }: { ... name: Promise<…>` style.
    // We rewrite the destructure: turn `name` (alone or in list) into
    // `name: ${name}Promise` so the body's `name.X` becomes a fresh const.
    //
    // Two flavors:
    //   `{ params }: { params: Promise<…> }`
    //   `{ params, searchParams }: { params: Promise<…>, searchParams: Promise<…> }`
    //
    // We only rename if the corresponding type is Promise<…> (i.e. we
    // promisified it above).
    const typeHasPromise = new RegExp(`${name}\\s*:\\s*Promise<`).test(src);
    if (!typeHasPromise) continue;

    // Replace `{ name }` or `{ name,` or `, name }` or `, name,` in
    // destructure positions. Use a function-aware sweep: look for
    // `function NAME(... { ${name}` patterns.
    const fnRe = /(export\s+(?:default\s+)?async?\s*function\s+\w*\s*\([^)]*?)\{([^{}]*?)\}(\s*:\s*\{)/g;
    src = src.replace(fnRe, (whole, head, destruct, tail) => {
      const parts = destruct.split(",").map((p) => p.trim()).filter(Boolean);
      let changed = false;
      const renamed = parts.map((p) => {
        if (p === name) {
          changed = true;
          return `${name}: ${name}Promise`;
        }
        return p;
      });
      if (!changed) return whole;
      return `${head}{ ${renamed.join(", ")} }${tail}`;
    });

    // Insert `const name = await namePromise;` at function body start.
    // We target any function whose signature contains `${name}Promise`.
    const bodyRe = new RegExp(
      `(function\\s+\\w*\\s*\\([^)]*?${name}Promise[^)]*?\\)\\s*(?::\\s*[^\\n{]+)?\\s*\\{)`,
      "g"
    );
    src = src.replace(bodyRe, (head) => {
      // Avoid double-injection
      if (
        src
          .slice(src.indexOf(head) + head.length, src.indexOf(head) + head.length + 200)
          .includes(`const ${name} = await ${name}Promise`)
      ) {
        return head;
      }
      return `${head}\n  const ${name} = await ${name}Promise;`;
    });
  }

  if (src !== original) {
    fs.writeFileSync(file, src);
    totalFiles++;
  }
}

console.log(`Rewrote ${totalSites} type sites across ${totalFiles} files.`);
