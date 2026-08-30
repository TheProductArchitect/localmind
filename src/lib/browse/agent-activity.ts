/**
 * Live feed of what the agent is doing in a browse session, so the Browse
 * chrome can narrate it ("Sora clicked Sign in") outside the page, where web
 * content cannot forge it.
 *
 * In-memory and per-session: this is presentation state, not an audit trail
 * (security events still go through web-guard / logSecurityEvent).
 */

export type AgentActivity = {
  sessionId: string;
  at: number;
  action: string;
  detail: string;
  ok: boolean;
};

const MAX_PER_SESSION = 40;

const history = new Map<string, AgentActivity[]>();
const listeners = new Map<string, Set<(a: AgentActivity) => void>>();

export function recordAgentActivity(entry: Omit<AgentActivity, "at">): AgentActivity {
  const full: AgentActivity = { ...entry, at: Date.now() };
  const list = history.get(entry.sessionId) ?? [];
  list.push(full);
  if (list.length > MAX_PER_SESSION) list.splice(0, list.length - MAX_PER_SESSION);
  history.set(entry.sessionId, list);

  for (const cb of listeners.get(entry.sessionId) ?? []) {
    try {
      cb(full);
    } catch {
      /* a broken subscriber must not stop the action */
    }
  }
  return full;
}

export function getAgentActivity(sessionId: string): AgentActivity[] {
  return [...(history.get(sessionId) ?? [])];
}

export function subscribeAgentActivity(
  sessionId: string,
  cb: (a: AgentActivity) => void
): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(cb);
  listeners.set(sessionId, set);
  return () => {
    const current = listeners.get(sessionId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) listeners.delete(sessionId);
  };
}

/** Drop feed state when a session ends. */
export function clearAgentActivity(sessionId: string): void {
  history.delete(sessionId);
  listeners.delete(sessionId);
}
