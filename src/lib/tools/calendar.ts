import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

export const calendarTool: Tool = {
  actionType: "read_calendar",
  classify: (i) => (i.operation === "create" ? "write_calendar" : "read_calendar"),
  preview: (i) => {
    if (i.operation === "create")
      return `Create event "${i.title}" on ${i.start}${i.end ? ` until ${i.end}` : ""}`;
    return `Read calendar events from ${i.from} to ${i.to}`;
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
        const script = `
set output to ""
set d1 to current date
set d2 to (current date) + (7 * days)
tell application "Calendar"
  repeat with c in calendars
    repeat with e in (every event of c whose start date ≥ d1 and start date ≤ d2)
      set output to output & (summary of e) & " — " & ((start date of e) as string) & linefeed
    end repeat
  end repeat
end tell
return output`;
        const out = await runAppleScript(script);
        return { ok: true, output: out || "(no events in the next 7 days)", summary: "read calendar" };
      }
      if (input.operation === "create") {
        const cal = String(input.calendar || "Calendar");
        const title = String(input.title || "Untitled").replace(/"/g, '\\"');
        const script = `
tell application "Calendar"
  tell calendar "${cal}"
    make new event with properties {summary:"${title}", start date:(current date), end date:(current date) + (3600)}
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
