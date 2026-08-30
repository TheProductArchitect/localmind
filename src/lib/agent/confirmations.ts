// In-memory store of pending tool-call confirmations.
type Pending = {
  resolve: (decision: "allow" | "deny" | "timeout") => void;
  decided: boolean;
  requiresPin: boolean;
  channelKey?: string;
  preview?: string;
};

const pending = new Map<string, Pending>();

/** Channel-scoped pending confirmation (latest per channel user). */
const channelLatest = new Map<string, string>();

export type ConfirmationOutcome = "allow" | "deny" | "timeout";

export function awaitConfirmation(
  toolCallId: string,
  timeoutMs: number,
  requiresPin: boolean,
  extras?: { channelKey?: string; preview?: string }
): Promise<ConfirmationOutcome> {
  return new Promise((resolve) => {
    const entry: Pending = {
      decided: false,
      requiresPin,
      channelKey: extras?.channelKey,
      preview: extras?.preview,
      resolve: (d) => {
        if (entry.decided) return;
        entry.decided = true;
        pending.delete(toolCallId);
        if (extras?.channelKey) channelLatest.delete(extras.channelKey);
        resolve(d);
      },
    };
    pending.set(toolCallId, entry);
    if (extras?.channelKey) channelLatest.set(extras.channelKey, toolCallId);
    setTimeout(() => entry.resolve("timeout"), timeoutMs);
  });
}

export function confirmationRequiresPin(toolCallId: string): boolean | null {
  const entry = pending.get(toolCallId);
  return entry ? entry.requiresPin : null;
}

export function submitConfirmation(toolCallId: string, decision: "allow" | "deny"): boolean {
  const entry = pending.get(toolCallId);
  if (!entry) return false;
  entry.resolve(decision);
  return true;
}

const AFFIRMATIVE = /^(yes|y|allow|approve|ok|confirm)\b/i;
const NEGATIVE = /^(no|n|deny|reject|cancel)\b/i;

/**
 * If the inbound channel message is a confirmation reply, resolve the pending
 * tool call. Returns { handled, decision } when matched.
 */
export function tryChannelConfirmation(
  channelKey: string,
  text: string
): { handled: boolean; decision?: "allow" | "deny"; preview?: string } {
  const toolCallId = channelLatest.get(channelKey);
  if (!toolCallId) return { handled: false };
  const trimmed = text.trim();
  if (AFFIRMATIVE.test(trimmed)) {
    const entry = pending.get(toolCallId);
    const preview = entry?.preview;
    // Plaintext channels cannot prove a PIN. Never let YES unlock pin-tier work.
    if (entry?.requiresPin) {
      submitConfirmation(toolCallId, "deny");
      return { handled: true, decision: "deny", preview };
    }
    submitConfirmation(toolCallId, "allow");
    return { handled: true, decision: "allow", preview };
  }
  if (NEGATIVE.test(trimmed)) {
    const entry = pending.get(toolCallId);
    const preview = entry?.preview;
    submitConfirmation(toolCallId, "deny");
    return { handled: true, decision: "deny", preview };
  }
  return { handled: false };
}

export function getChannelPendingPreview(channelKey: string): string | null {
  const toolCallId = channelLatest.get(channelKey);
  if (!toolCallId) return null;
  return pending.get(toolCallId)?.preview ?? null;
}
