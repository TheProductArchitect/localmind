import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import type { Tool } from "./types";

function expand(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || ""));
}

async function resolveSafe(p: string, approved: string[]): Promise<string | null> {
  if (!p || approved.length === 0) return null;
  const abs = expand(p);
  let existing = abs;
  let remainder = "";
  while (!fsSync.existsSync(existing)) {
    remainder = remainder ? path.join(path.basename(existing), remainder) : path.basename(existing);
    const parent = path.dirname(existing);
    if (parent === existing) return null;
    existing = parent;
  }
  let realAbs: string;
  try {
    realAbs = remainder ? path.join(await fs.realpath(existing), remainder) : await fs.realpath(existing);
  } catch {
    return null;
  }
  for (const dir of approved) {
    const realDir = await fs.realpath(expand(dir)).catch(() => null);
    if (!realDir) continue;
    if (realAbs === realDir || realAbs.startsWith(realDir + path.sep)) return realAbs;
  }
  return null;
}

// ---- Tiny CSV parser/encoder ---------------------------------------------
//
// Handles RFC4180 essentials: double quotes around fields containing commas,
// quotes, or newlines, and "" as the escape for an embedded quote. Pure-JS
// so we don't pull in another dependency.

function csvEncode(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          if (s.includes(",") || s.includes("\n") || s.includes('"')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    )
    .join("\n");
}

function csvDecode(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvToRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const grid = csvDecode(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0];
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
  return { headers, rows };
}

// ---- Statistical summary -------------------------------------------------

function summarise(headers: string[], rows: Record<string, string>[]): string {
  const lines: string[] = [`${rows.length} row(s), ${headers.length} column(s)`];
  for (const h of headers) {
    const values = rows.map((r) => r[h]).filter((v) => v !== "");
    const numeric = values
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    if (numeric.length > 0 && numeric.length === values.length) {
      const sum = numeric.reduce((a, b) => a + b, 0);
      const min = Math.min(...numeric);
      const max = Math.max(...numeric);
      const avg = sum / numeric.length;
      lines.push(`  ${h} (numeric): min=${min}, max=${max}, avg=${avg.toFixed(2)}, sum=${sum}`);
    } else {
      const unique = new Set(values);
      lines.push(`  ${h} (text): ${values.length} values, ${unique.size} unique`);
    }
  }
  return lines.join("\n");
}

// ---- Tool -----------------------------------------------------------------

export const spreadsheetTool: Tool = {
  actionType: "write_files",
  classify: (i) => {
    const op = String(i.operation || "");
    return op === "read_spreadsheet" || op === "summarise_spreadsheet" ? "read_files" : "write_files";
  },
  version: "1",
  cacheable: (i) => {
    const op = String(i.operation || "");
    return op === "read_spreadsheet" || op === "summarise_spreadsheet";
  },
  preview: (i) => {
    const op = String(i.operation || "");
    const f = String(i.path || "(no path)");
    if (op === "create_spreadsheet") return `Create CSV at ${f} with ${(i.headers || []).join(", ")}`;
    if (op === "append_row") return `Append row to ${f}`;
    if (op === "update_row") return `Update rows in ${f} where ${i.match_column}=${i.match_value}`;
    if (op === "read_spreadsheet") return `Read CSV at ${f}`;
    if (op === "summarise_spreadsheet") return `Summarise CSV at ${f}`;
    return `Spreadsheet: ${op}`;
  },
  definition: {
    name: "spreadsheet",
    description:
      "Create and manage CSV files inside the user's approved folders. Operations: create_spreadsheet (new file with headers), append_row (add a row), update_row (match by column value), read_spreadsheet (all rows as JSON), summarise_spreadsheet (statistical summary).",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["create_spreadsheet", "append_row", "update_row", "read_spreadsheet", "summarise_spreadsheet"],
        },
        path: { type: "string", description: "Absolute file path inside an approved folder. .csv extension recommended." },
        headers: { type: "array", items: { type: "string" }, description: "Column headers for create_spreadsheet." },
        row: { type: "object", description: "Row as { header: value }. Used by create_spreadsheet (first row, optional), append_row, update_row (the new values)." },
        match_column: { type: "string", description: "Column to match for update_row." },
        match_value: { type: "string", description: "Value the match_column must equal for update_row." },
      },
      required: ["operation", "path"],
    },
  },
  async execute(input, ctx) {
    const op = String(input.operation || "");
    const requested = String(input.path || "");
    if (!requested) return { ok: false, output: "path is required" };

    const safe = await resolveSafe(requested, ctx.approvedDirs);
    if (!safe) {
      return {
        ok: false,
        output: `Refusing to access "${requested}" — it isn't inside an approved folder. Add it under Settings → Approved folders.`,
      };
    }

    try {
      if (op === "create_spreadsheet") {
        const headers = Array.isArray(input.headers) ? (input.headers as string[]) : [];
        if (headers.length === 0) return { ok: false, output: "headers must be a non-empty array" };
        if (fsSync.existsSync(safe)) {
          return { ok: false, output: `File already exists at ${safe}. Use append_row or update_row instead.` };
        }
        await fs.mkdir(path.dirname(safe), { recursive: true });
        const rows: string[][] = [headers];
        if (input.row && typeof input.row === "object") {
          const r = input.row as Record<string, unknown>;
          rows.push(headers.map((h) => (r[h] == null ? "" : String(r[h]))));
        }
        await fs.writeFile(safe, csvEncode(rows) + "\n", "utf8");
        return { ok: true, output: `Created ${safe}`, summary: `created CSV with ${headers.length} columns` };
      }

      if (op === "append_row") {
        if (!input.row || typeof input.row !== "object") return { ok: false, output: "row must be an object" };
        if (!fsSync.existsSync(safe)) return { ok: false, output: `File not found at ${safe}.` };
        const cur = await fs.readFile(safe, "utf8");
        const parsed = csvToRecords(cur);
        if (parsed.headers.length === 0) return { ok: false, output: "Existing file has no headers row." };
        const r = input.row as Record<string, unknown>;
        const newRow = parsed.headers.map((h) => (r[h] == null ? "" : String(r[h])));
        const out = (cur.endsWith("\n") ? cur : cur + "\n") + csvEncode([newRow]) + "\n";
        await fs.writeFile(safe, out, "utf8");
        return { ok: true, output: `Appended 1 row.`, summary: "appended row" };
      }

      if (op === "update_row") {
        const col = String(input.match_column || "");
        const val = String(input.match_value || "");
        if (!col) return { ok: false, output: "match_column is required" };
        if (!fsSync.existsSync(safe)) return { ok: false, output: `File not found at ${safe}.` };
        const r = (input.row || {}) as Record<string, unknown>;
        const cur = await fs.readFile(safe, "utf8");
        const parsed = csvToRecords(cur);
        if (!parsed.headers.includes(col)) {
          return { ok: false, output: `Column "${col}" not found. Available: ${parsed.headers.join(", ")}` };
        }
        let touched = 0;
        for (const row of parsed.rows) {
          if (row[col] === val) {
            for (const [k, v] of Object.entries(r)) {
              if (parsed.headers.includes(k)) row[k] = v == null ? "" : String(v);
            }
            touched++;
          }
        }
        const out =
          csvEncode([parsed.headers, ...parsed.rows.map((rec) => parsed.headers.map((h) => rec[h] ?? ""))]) + "\n";
        await fs.writeFile(safe, out, "utf8");
        return {
          ok: true,
          output: touched > 0 ? `Updated ${touched} row(s).` : "No rows matched — nothing changed.",
          summary: `${touched} row(s) updated`,
        };
      }

      if (op === "read_spreadsheet") {
        if (!fsSync.existsSync(safe)) return { ok: false, output: `File not found at ${safe}.` };
        const cur = await fs.readFile(safe, "utf8");
        const parsed = csvToRecords(cur);
        return {
          ok: true,
          output: JSON.stringify({ headers: parsed.headers, rows: parsed.rows.slice(0, 200) }, null, 2),
          summary: `read ${parsed.rows.length} row(s)`,
        };
      }

      if (op === "summarise_spreadsheet") {
        if (!fsSync.existsSync(safe)) return { ok: false, output: `File not found at ${safe}.` };
        const cur = await fs.readFile(safe, "utf8");
        const parsed = csvToRecords(cur);
        return { ok: true, output: summarise(parsed.headers, parsed.rows), summary: "summarised CSV" };
      }

      return { ok: false, output: `Unknown operation: ${op}` };
    } catch (e) {
      return { ok: false, output: `Spreadsheet error: ${(e as Error).message}` };
    }
  },
};

/** Lists all .csv files in the approved directories with a row count. */
export async function listManagedSpreadsheets(approvedDirs: string[]): Promise<
  Array<{ path: string; rows: number; size: number; modified: number }>
> {
  const out: Array<{ path: string; rows: number; size: number; modified: number }> = [];
  for (const dir of approvedDirs) {
    const realDir = expand(dir);
    if (!fsSync.existsSync(realDir)) continue;
    await walkCsv(realDir, out);
  }
  return out;
}

async function walkCsv(
  dir: string,
  out: Array<{ path: string; rows: number; size: number; modified: number }>,
  depth = 0
): Promise<void> {
  if (depth > 4) return; // bound recursion
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".")) continue;
      await walkCsv(p, out, depth + 1);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) {
      try {
        const st = await fs.stat(p);
        const text = await fs.readFile(p, "utf8");
        const grid = csvDecode(text).filter((r) => !(r.length === 1 && r[0] === ""));
        out.push({ path: p, rows: Math.max(0, grid.length - 1), size: st.size, modified: st.mtimeMs });
      } catch { /* skip unreadable */ }
    }
  }
}
