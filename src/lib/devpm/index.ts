import fs from "fs";
import path from "path";
import {
  getCodebase, replaceCodebaseFiles, listCodebaseFiles, listCodebases,
} from "../db/devpm";

const LANG: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".rb": "Ruby",
  ".c": "C", ".cpp": "C++", ".cs": "C#", ".php": "PHP", ".swift": "Swift",
  ".md": "Markdown", ".json": "JSON", ".css": "CSS", ".html": "HTML", ".sh": "Shell",
};
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".venv", "__pycache__", "vendor"]);

function extractSymbols(content: string): string[] {
  const syms: string[] = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:export\s+)?class\s+(\w+)/g,
    /(?:export\s+)?const\s+(\w+)\s*=/g,
    /def\s+(\w+)/g,
    /func\s+(\w+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) && syms.length < 40) syms.push(m[1]);
  }
  return [...new Set(syms)];
}

// Indexes a codebase: walks the directory and records each source file's
// path, language, exported symbols and a short heuristic summary.
export function indexCodebase(codebaseId: string): { files: number } {
  const cb = getCodebase(codebaseId);
  if (!cb) throw new Error("Codebase not found");
  const root = cb.path.replace(/^~/, process.env.HOME || "");
  const files: any[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 8 || files.length > 3000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1);
      } else {
        const ext = path.extname(e.name);
        const lang = LANG[ext];
        if (!lang) continue;
        let content = "";
        try {
          const stat = fs.statSync(full);
          if (stat.size > 400_000) continue;
          content = fs.readFileSync(full, "utf8");
        } catch { continue; }
        const symbols = extractSymbols(content);
        const firstComment = content.split("\n").find((l) => /^\s*(\/\/|#|\*)/.test(l)) || "";
        files.push({
          rel_path: path.relative(root, full),
          language: lang,
          summary: firstComment.replace(/^[\s/#*]+/, "").slice(0, 160) || `${lang} file`,
          symbols: JSON.stringify(symbols),
        });
      }
    }
  }
  walk(root, 0);
  replaceCodebaseFiles(codebaseId, files);
  return { files: files.length };
}

// Builds a compact codebase summary for the DevPM system prompt.
export function devpmSystemPrefix(): string {
  const codebases = listCodebases();
  if (codebases.length === 0) {
    return "You are DevPM, a development project manager assistant. No codebases are registered yet — suggest the user register one in the DevPM panel.";
  }
  let prefix = "You are DevPM, a development project manager assistant. You are aware of these registered codebases:\n";
  for (const cb of codebases) {
    const files = listCodebaseFiles(cb.id);
    prefix += `\n## ${cb.name} (${cb.path}) — ${files.length} files, indexed ${cb.last_indexed_at ? new Date(cb.last_indexed_at).toLocaleString() : "never"}\n`;
    const byLang: Record<string, number> = {};
    for (const f of files) byLang[f.language || "?"] = (byLang[f.language || "?"] || 0) + 1;
    prefix += "Languages: " + Object.entries(byLang).map(([l, n]) => `${l} (${n})`).join(", ") + "\n";
    prefix += "Key files: " + files.slice(0, 25).map((f) => f.rel_path).join(", ") + "\n";
  }
  prefix += "\nIf the codebase may have changed since indexing, say so and offer to re-index. Use the devpm_codebase tool to look up files and symbols.";
  return prefix;
}
