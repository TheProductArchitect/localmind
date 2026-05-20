import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { TRASH_DIR } from "../paths";
import type { Tool } from "./types";

function expand(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || ""));
}

// Resolves the real (symlink-followed) path and confirms it stays inside an
// approved directory. Prevents symlink-traversal escapes — a symlink within an
// approved folder that points outside it is rejected.
async function resolveSafe(p: string, approved: string[]): Promise<string | null> {
  if (!p || approved.length === 0) return null;
  const abs = expand(p);

  // Resolve the real path of the deepest existing ancestor, then re-append the
  // not-yet-existing remainder (covers writes to new files).
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
    let realDir: string;
    try {
      realDir = await fs.realpath(expand(dir));
    } catch {
      continue;
    }
    if (realAbs === realDir || realAbs.startsWith(realDir + path.sep)) return realAbs;
  }
  return null;
}

export const filesystemTool: Tool = {
  actionType: "read_files",
  classify: (input) => {
    switch (input.operation) {
      case "write": return "write_files";
      case "delete": return "delete_files";
      case "read":
      case "list":
      default: return "read_files";
    }
  },
  preview: (input) => {
    const op = input.operation;
    const p = input.path;
    if (op === "write") {
      const content = String(input.content || "");
      return `Write to ${p}\n\n${content.slice(0, 200)}${content.length > 200 ? "…" : ""}`;
    }
    if (op === "delete") return `Move to trash: ${p}`;
    return `${op} ${p}`;
  },
  definition: {
    name: "filesystem",
    description:
      "Read, write, list, or delete files within user-approved directories. Operations: read, write, list, delete.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "write", "list", "delete"] },
        path: { type: "string", description: "Absolute path within an approved directory" },
        content: { type: "string", description: "Content to write (write only)" },
      },
      required: ["operation", "path"],
    },
  },
  async execute(input, ctx) {
    const op = input.operation;
    const safe = await resolveSafe(String(input.path || ""), ctx.approvedDirs);
    if (!safe) {
      return { ok: false, output: "Path is not within an approved directory.", summary: "denied: path out of scope" };
    }
    try {
      if (op === "read") {
        const data = await fs.readFile(safe, "utf8");
        return { ok: true, output: data, summary: `read ${safe} (${data.length} bytes)` };
      }
      if (op === "list") {
        const items = await fs.readdir(safe, { withFileTypes: true });
        const lines = items.map((d) => `${d.isDirectory() ? "[dir] " : ""}${d.name}`).join("\n");
        return { ok: true, output: lines || "(empty)", summary: `list ${safe} (${items.length})` };
      }
      if (op === "write") {
        await fs.mkdir(path.dirname(safe), { recursive: true });
        await fs.writeFile(safe, String(input.content || ""), "utf8");
        return { ok: true, output: `Wrote ${safe}`, summary: `wrote ${safe}` };
      }
      if (op === "delete") {
        const dest = path.join(TRASH_DIR, `${Date.now()}-${path.basename(safe)}`);
        await fs.rename(safe, dest);
        return { ok: true, output: `Moved to trash: ${dest}`, summary: `trashed ${safe}` };
      }
      return { ok: false, output: `Unknown operation: ${op}` };
    } catch (e: any) {
      return { ok: false, output: `Operation failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
