import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

function asString(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

export const contactsTool: Tool = {
  actionType: "read_contacts",
  preview: (i) => {
    if (i.operation === "search") return `Search contacts: ${i.query}`;
    return `Get contact: ${i.name}`;
  },
  definition: {
    name: "contacts",
    description:
      "Search or look up contacts in macOS Contacts. Operations: search (by name/email), get (exact name).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["search", "get"] },
        query: { type: "string", description: "Search term (search)" },
        name: { type: "string", description: "Contact name (get)" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    try {
      if (input.operation === "search") {
        const q = asString(input.query);
        const script = `
set output to ""
tell application "Contacts"
  repeat with p in people
    set n to name of p
    if n contains "${q}" then
      set output to output & n
      try
        set output to output & " <" & (value of first email of p) & ">"
      end try
      set output to output & linefeed
    end if
  end repeat
end tell
return output`;
        const out = await runAppleScript(script);
        return { ok: true, output: out || "(no matches)", summary: `searched contacts for "${input.query}"` };
      }
      if (input.operation === "get") {
        const name = asString(input.name);
        const script = `
tell application "Contacts"
  set matches to (every person whose name is "${name}")
  if (count of matches) = 0 then return "(not found)"
  set p to item 1 of matches
  set output to name of p
  try
    set output to output & linefeed & "Email: " & (value of first email of p)
  end try
  try
    set output to output & linefeed & "Phone: " & (value of first phone of p)
  end try
  return output
end tell`;
        const out = await runAppleScript(script);
        return { ok: true, output: out, summary: `looked up ${input.name}` };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Contacts action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
