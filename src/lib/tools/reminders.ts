import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

function asString(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

export const remindersTool: Tool = {
  actionType: "read_reminders",
  classify: (i) => (i.operation === "create" ? "write_reminders" : "read_reminders"),
  preview: (i) => {
    if (i.operation === "create") return `Create reminder: ${i.title}`;
    return `List reminders${i.list ? ` in "${i.list}"` : ""}`;
  },
  definition: {
    name: "reminders",
    description:
      "Read or create items in macOS Reminders. Operations: read (list reminders), create (new reminder).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "create"] },
        list: { type: "string", description: "Reminders list name (default: Reminders)" },
        title: { type: "string", description: "Reminder title (create)" },
        notes: { type: "string", description: "Reminder notes (create)" },
        due: { type: "string", description: "Due date/time string (create)" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    try {
      if (input.operation === "read") {
        const listName = asString(input.list || "Reminders");
        const script = `
set output to ""
tell application "Reminders"
  set theList to list "${listName}"
  repeat with r in (reminders of theList whose completed is false)
    set output to output & (name of r) & linefeed
  end repeat
end tell
return output`;
        const out = await runAppleScript(script);
        return { ok: true, output: out || "(no open reminders)", summary: "read reminders" };
      }
      if (input.operation === "create") {
        const listName = asString(input.list || "Reminders");
        const title = asString(input.title || "Untitled");
        const notes = asString(input.notes || "");
        const due = asString(input.due || "");
        const dueClause = due ? `, due date:(date "${due}")` : "";
        const script = `
tell application "Reminders"
  tell list "${listName}"
    make new reminder with properties {name:"${title}", body:"${notes}"${dueClause}}
  end tell
end tell
return "created"`;
        await runAppleScript(script);
        return { ok: true, output: `Created reminder "${input.title}"`, summary: "created reminder" };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Reminders action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
