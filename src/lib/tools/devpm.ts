import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  listCodebases, getCodebase, searchCodebaseFiles, listDevTasks, createDevTask,
} from "../db/devpm";
import type { Tool } from "./types";

const exec = promisify(execFile);

export const devpmTool: Tool = {
  actionType: "read_files",
  classify: (i) => (i.operation === "run_command" ? "open_applications" : i.operation === "create_task" ? "memory_write" : "read_files"),
  forcedTier: undefined,
  preview: (i) => {
    if (i.operation === "run_command") return `Run command "${i.command}" in codebase ${i.codebase}`;
    if (i.operation === "read_file") return `Read ${i.path}`;
    return `DevPM: ${i.operation}`;
  },
  definition: {
    name: "devpm_codebase",
    description:
      "DevPM development tools. Operations: list_codebases, search (find files/symbols), read_file (read a file from a codebase), list_tasks, create_task, run_command (run a registered named command).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["list_codebases", "search", "read_file", "list_tasks", "create_task", "run_command"] },
        codebase: { type: "string", description: "Codebase name or id" },
        query: { type: "string" },
        path: { type: "string", description: "Relative path within the codebase" },
        title: { type: "string" },
        command: { type: "string", description: "Name of a registered command" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const codebases = listCodebases();
    const cb =
      input.codebase
        ? codebases.find((c) => c.id === input.codebase || c.name.toLowerCase() === String(input.codebase).toLowerCase())
        : codebases[0];

    if (input.operation === "list_codebases") {
      return {
        ok: true,
        output: codebases.length
          ? codebases.map((c) => `- ${c.name} (${c.file_count} files) at ${c.path}`).join("\n")
          : "No codebases registered.",
        summary: "list codebases",
      };
    }
    if (input.operation === "list_tasks") {
      const tasks = listDevTasks();
      return {
        ok: true,
        output: tasks.length ? tasks.map((t) => `[${t.status}] ${t.title} (${t.priority})`).join("\n") : "No tasks.",
        summary: "list tasks",
      };
    }
    if (input.operation === "create_task") {
      if (!input.title) return { ok: false, output: "title required" };
      const t = createDevTask(String(input.title));
      return { ok: true, output: `Created task: ${t.title}`, summary: "task created" };
    }
    if (!cb) return { ok: false, output: "No matching codebase. Register one in the DevPM panel." };

    if (input.operation === "search") {
      const files = searchCodebaseFiles(cb.id, String(input.query || ""));
      return {
        ok: true,
        output: files.length
          ? files.map((f) => `${f.rel_path} [${f.language}]\n  ${f.summary}\n  symbols: ${f.symbols}`).join("\n\n")
          : "No matching files.",
        summary: `search ${cb.name}`,
      };
    }
    if (input.operation === "read_file") {
      try {
        const root = cb.path.replace(/^~/, process.env.HOME || "");
        const full = path.resolve(root, String(input.path || ""));
        // Resolve symlinks on both sides so a symlinked file cannot escape the codebase root.
        const realRoot = await fs.realpath(root);
        const realFull = await fs.realpath(full);
        if (realFull !== realRoot && !realFull.startsWith(realRoot + path.sep)) {
          return { ok: false, output: "Path escapes the codebase root.", summary: "denied: out of scope" };
        }
        const content = await fs.readFile(realFull, "utf8");
        return { ok: true, output: content.slice(0, 12000), summary: `read ${input.path}` };
      } catch (e: any) {
        return { ok: false, output: `Could not read file: ${e?.message}`, summary: "failed" };
      }
    }
    if (input.operation === "run_command") {
      const commands = JSON.parse(cb.commands || "[]") as { name: string; command: string }[];
      const match = commands.find((c) => c.name === input.command);
      if (!match) return { ok: false, output: `No registered command named "${input.command}".` };
      try {
        const root = cb.path.replace(/^~/, process.env.HOME || "");
        const { stdout, stderr } = await exec("sh", ["-c", match.command], { cwd: root, timeout: 120000 });
        return { ok: true, output: (stdout + stderr).slice(0, 8000) || "(no output)", summary: `ran ${match.name}` };
      } catch (e: any) {
        return { ok: false, output: `Command failed: ${e?.message}\n${e?.stdout || ""}${e?.stderr || ""}`, summary: "failed" };
      }
    }
    return { ok: false, output: `Unknown operation: ${input.operation}` };
  },
};
