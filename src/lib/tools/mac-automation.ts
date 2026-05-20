import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

export const macAutomationTool: Tool = {
  actionType: "open_applications",
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
        const app = String(input.app || "").replace(/"/g, '\\"');
        await runAppleScript(`tell application "${app}" to activate`);
        return { ok: true, output: `Opened ${input.app}`, summary: `opened ${input.app}` };
      }
      if (input.operation === "open_url") {
        const url = String(input.url || "").replace(/"/g, '\\"');
        await runAppleScript(`tell application "Safari" to open location "${url}"`);
        return { ok: true, output: `Opened ${input.url} in Safari`, summary: `opened url` };
      }
      if (input.operation === "notify") {
        const msg = String(input.message || "").replace(/"/g, '\\"');
        await runAppleScript(`display notification "${msg}" with title "LocalMind"`);
        return { ok: true, output: "Notification posted", summary: "notification" };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Mac action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
