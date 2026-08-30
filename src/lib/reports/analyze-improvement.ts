/**
 * One-shot local LLM pass over a user improvement report.
 * No tools, no conversation thread — critic-style direct provider chat.
 */

import { getSettings } from "@/lib/db/queries";
import { getProvider } from "@/lib/providers";
import type { ReportAnalysis } from "@/lib/db/user-reports";
import { readRecentLogLines } from "@/lib/logger";

const SYSTEM = `You are LocalMind's product critic. The user just filed an in-app
improvement report while using the desktop/local assistant. Stay local —
never suggest uploading data elsewhere.

Respond with ONLY a single JSON object (no markdown fences) shaped as:
{
  "title": "short issue title",
  "summary": "1-3 sentences describing the problem and why it matters",
  "severity": "low" | "medium" | "high",
  "suggestions": ["concrete fix 1", "concrete fix 2", "..."],
  "related_areas": ["chat", "browse", "fleet", "..."]
}

Be specific to LocalMind (Electron shell, chat, Browse tabs, Fleet, Ops).
Prefer actionable UI/UX or reliability fixes over vague advice.
If the note is empty, infer from route + errors; say when evidence is thin.`;

export type AnalyzeInput = {
  route: string;
  note: string;
  clientErrors?: string[];
  userAgent?: string;
  screenshotDataUrl?: string | null;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Model did not return JSON");
}

function normalizeAnalysis(raw: unknown, fallbackNote: string): ReportAnalysis {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const severityRaw = String(o.severity || "medium").toLowerCase();
  const severity =
    severityRaw === "high" || severityRaw === "low" ? severityRaw : "medium";
  const suggestions = Array.isArray(o.suggestions)
    ? o.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  const related = Array.isArray(o.related_areas)
    ? o.related_areas.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    title: String(o.title || fallbackNote.slice(0, 72) || "Improvement report").trim(),
    summary: String(o.summary || "Needs review.").trim(),
    severity,
    suggestions:
      suggestions.length > 0
        ? suggestions
        : ["Review the reported route and recent errors, then propose a focused UI fix."],
    related_areas: related,
  };
}

export async function analyzeImprovementReport(
  input: AnalyzeInput,
  opts?: { signal?: AbortSignal }
): Promise<{ analysis: ReportAnalysis; serverErrors: string[] }> {
  const settings = getSettings();
  const model = settings.active_model;
  if (!model) {
    throw new Error("No active model — pick one in Models / Settings first.");
  }

  const serverErrors = readRecentLogLines(200)
    .map((line) => {
      try {
        const j = JSON.parse(line) as { level?: string; message?: string; ts?: number };
        if (j.level === "error" || j.level === "warn") {
          return `${j.level}: ${j.message || line}`;
        }
      } catch {
        if (/error|exception|fail/i.test(line)) return line;
      }
      return null;
    })
    .filter(Boolean)
    .slice(-25) as string[];

  const clientErrors = (input.clientErrors || []).slice(-20);
  const userParts: string[] = [
    `Route: ${input.route}`,
    `User note:\n${input.note.trim() || "(none — infer from context)"}`,
    `User-Agent: ${input.userAgent || "unknown"}`,
    clientErrors.length
      ? `Recent client errors:\n${clientErrors.map((e) => `- ${e}`).join("\n")}`
      : "Recent client errors: (none)",
    serverErrors.length
      ? `Recent server log warnings/errors:\n${serverErrors.map((e) => `- ${e}`).join("\n")}`
      : "Recent server log warnings/errors: (none)",
  ];

  if (input.screenshotDataUrl) {
    userParts.push("A screenshot of the UI at report time is attached as an image.");
  }

  const images =
    input.screenshotDataUrl && input.screenshotDataUrl.startsWith("data:image/")
      ? [input.screenshotDataUrl.replace(/^data:image\/\w+;base64,/, "")]
      : undefined;

  let text = "";
  for await (const d of getProvider().chat({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: userParts.join("\n\n"),
        ...(images ? { images } : {}),
      },
    ],
    tools: [],
    signal: opts?.signal,
    contextWindow: settings.context_window,
  })) {
    if (d.type === "text") text += d.delta;
  }

  const analysis = normalizeAnalysis(extractJson(text), input.note);
  return { analysis, serverErrors };
}
