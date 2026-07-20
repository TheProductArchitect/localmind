import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

function asString(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

function parseDate(input: string | undefined, fallback: Date): Date {
  if (!input) return fallback;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export const calendarTool: Tool = {
  actionType: "read_calendar",
  classify: (i) => (i.operation === "create" ? "write_calendar" : "read_calendar"),
  preview: (i) => {
    if (i.operation === "create")
      return `Create event "${i.title}" on ${i.start}${i.end ? ` until ${i.end}` : ""}`;
    return `Read calendar events from ${i.from || "(today)"} to ${i.to || "(+7 days)"}`;
  },
  definition: {
    name: "calendar",
    description:
      "Read events from or create events in macOS Calendar. Operations: read (date range), create (event).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "create"] },
        from: { type: "string", description: "Start date YYYY-MM-DD (read)" },
        to: { type: "string", description: "End date YYYY-MM-DD (read)" },
        title: { type: "string", description: "Event title (create)" },
        start: { type: "string", description: "Event start, e.g. 2026-06-01 14:00 (create)" },
        end: { type: "string", description: "Event end (create)" },
        calendar: { type: "string", description: "Calendar name" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    try {
      if (input.operation === "read") {
        const now = new Date();
        const d1 = parseDate(String(input.from || ""), now);
        const d2 = parseDate(String(input.to || ""), new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
        const fmt = (d: Date) =>
          `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}:00`;
        const script = `
set output to ""
set d1 to date "${fmt(d1)}"
set d2 to date "${fmt(d2)}"
tell application "Calendar"
  repeat with c in calendars
    repeat with e in (every event of c whose start date ≥ d1 and start date ≤ d2)
      set output to output & (summary of e) & " — " & ((start date of e) as string) & linefeed
    end repeat
  end repeat
end tell
return output`;
        const out = await runAppleScript(script);
        return {
          ok: true,
          output: out || `(no events between ${input.from || "today"} and ${input.to || "+7 days"})`,
          summary: "read calendar",
        };
      }
      if (input.operation === "create") {
        const cal = asString(input.calendar || "Calendar");
        const title = asString(input.title || "Untitled");
        const start = asString(input.start || "");
        const end = asString(input.end || "");
        const startClause = start
          ? `start date:(date "${start}")`
          : "start date:(current date)";
        const endClause = end
          ? `, end date:(date "${end}")`
          : ", end date:(current date) + (3600)";
        const script = `
tell application "Calendar"
  tell calendar "${cal}"
    make new event with properties {summary:"${title}", ${startClause}${endClause}}
  end tell
end tell
return "created"`;
        await runAppleScript(script);
        return { ok: true, output: `Created event "${input.title}"`, summary: `created event` };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Calendar action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
