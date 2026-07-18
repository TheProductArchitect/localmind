import { runAppleScript } from "./applescript";
import type { Tool } from "./types";
import { isDestructiveCommand } from "../agent/permission-guard";

// Escape a value for safe interpolation inside an AppleScript double-quoted
// string. Backslashes MUST be escaped first — escaping only quotes (the old
// behaviour) let an input ending in `\` turn our closing quote into `\"`,
// breaking out of the string and injecting arbitrary AppleScript. Newlines are
// stripped so a value cannot terminate the statement.
function asString(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

export const macAutomationTool: Tool = {
  actionType: "open_applications",
  classify: (i) => {
    if (i.operation === "notify") return "open_applications";
    // open_app / open_url assemble AppleScript — escalate if the payload
    // looks destructive (rm/format/etc.), otherwise keep the open_applications tier.
    const hay = `${i.operation || ""} ${i.app || ""} ${i.url || ""} ${i.message || ""}`;
    if (isDestructiveCommand(hay)) return "destructive_shell";
    return "open_applications";
  },
  preview: (i) => {
    if (i.operation === "open_app") return `Open application: ${i.app}`;
    if (i.operation === "open_url") return `Open URL in Safari: ${i.url}`;
    if (i.operation === "notify") return `Show notification: ${i.message}`;
    return `Mac action: ${i.operation}`;
  },
  definition: {
    name: "mac_automation",
    description:
      "Control the Mac: open an application, open a URL in Safari, or post a notification. Operations: open_app, open_url, notify.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["open_app", "open_url", "notify"] },
        app: { type: "string" },
        url: { type: "string" },
        message: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    try {
      if (input.operation === "open_app") {
        const app = asString(input.app);
        await runAppleScript(`tell application "${app}" to activate`);
        return { ok: true, output: `Opened ${input.app}`, summary: `opened ${input.app}` };
      }
      if (input.operation === "open_url") {
        const raw = String(input.url || "").trim();
        // Only ever hand a vetted http(s) URL to Safari. This blocks AppleScript
        // breakout via the URL and also other URL schemes (file:, javascript:,
        // shortcuts:, etc.) that could trigger unintended local actions.
        if (!/^https?:\/\//i.test(raw)) {
          return { ok: false, output: "Only http(s) URLs can be opened.", summary: "rejected url" };
        }
        const url = asString(raw);
        await runAppleScript(`tell application "Safari" to open location "${url}"`);
        return { ok: true, output: `Opened ${raw} in Safari`, summary: `opened url` };
      }
      if (input.operation === "notify") {
        const msg = asString(input.message);
        await runAppleScript(`display notification "${msg}" with title "LocalMind"`);
        return { ok: true, output: "Notification posted", summary: "notification" };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Mac action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
