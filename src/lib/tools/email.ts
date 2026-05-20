import { runAppleScript } from "./applescript";
import type { Tool } from "./types";

export const emailTool: Tool = {
  actionType: "read_email",
  classify: (i) => (i.operation === "send" ? "send_email" : "read_email"),
  preview: (i) => {
    if (i.operation === "send")
      return `Send email to ${i.to}\nSubject: ${i.subject}\n\n${String(i.body || "").slice(0, 200)}`;
    return "Read recent inbox messages";
  },
  definition: {
    name: "email",
    description:
      "Read recent messages from or send messages via macOS Mail. Operations: read, send.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "send"] },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    try {
      if (input.operation === "read") {
        const script = `
set output to ""
tell application "Mail"
  set msgs to messages 1 thru 10 of inbox
  repeat with m in msgs
    set output to output & (subject of m) & " — " & (sender of m) & linefeed
  end repeat
end tell
return output`;
        const out = await runAppleScript(script);
        return { ok: true, output: out || "(inbox empty)", summary: "read inbox" };
      }
      if (input.operation === "send") {
        const to = String(input.to || "").replace(/"/g, '\\"');
        const subject = String(input.subject || "").replace(/"/g, '\\"');
        const body = String(input.body || "").replace(/"/g, '\\"');
        const script = `
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:false}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"${to}"}
    send
  end tell
end tell
return "sent"`;
        await runAppleScript(script);
        return { ok: true, output: `Email sent to ${input.to}`, summary: `sent email to ${input.to}` };
      }
      return { ok: false, output: `Unknown operation: ${input.operation}` };
    } catch (e: any) {
      return { ok: false, output: `Email action failed: ${e?.message || "unknown"}`, summary: "failed" };
    }
  },
};
