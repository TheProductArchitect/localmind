import { getChannel } from "../db/channels";
import { runAppleScript } from "../tools/applescript";
import { logger } from "../logger";

// Sends an email via the local macOS Mail app (fully local, no SMTP account in cloud).
export async function sendDigestEmail(subject: string, body: string): Promise<boolean> {
  const { config } = getChannel("email");
  const to = config.digestAddress;
  if (!to) {
    logger.warn("email digest skipped — no address configured");
    return false;
  }
  const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  try {
    await runAppleScript(`
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}", visible:false}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"${esc(to)}"}
    send
  end tell
end tell
return "sent"`);
    return true;
  } catch (e: any) {
    logger.error("email digest send failed", { error: e?.message });
    return false;
  }
}
