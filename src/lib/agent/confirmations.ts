// In-memory store of pending tool-call confirmations.
type Pending = {
  resolve: (decision: "allow" | "deny") => void;
  decided: boolean;
  requiresPin: boolean;
};

const pending = new Map<string, Pending>();

export function awaitConfirmation(
  toolCallId: string,
  timeoutMs: number,
  requiresPin: boolean
): Promise<"allow" | "deny"> {
  return new Promise((resolve) => {
    const entry: Pending = {
      decided: false,
      requiresPin,
      resolve: (d) => {
        if (entry.decided) return;
        entry.decided = true;
        pending.delete(toolCallId);
        resolve(d);
      },
    };
    pending.set(toolCallId, entry);
    setTimeout(() => entry.resolve("deny"), timeoutMs);
  });
}

// Returns whether a pending confirmation requires a PIN, or null if unknown.
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
