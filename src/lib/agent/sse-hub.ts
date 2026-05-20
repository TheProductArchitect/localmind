// SSE event hub: buffers events per conversation so a dropped client can
// reconnect with Last-Event-ID and resume without missing or duplicating events.

type BufferedEvent = { id: number; payload: string };
type Writer = (chunk: string) => void;

type Session = {
  buffer: BufferedEvent[];
  counter: number;
  finished: boolean;
  writers: Set<Writer>;
};

const sessions = new Map<string, Session>();
const MAX_BUFFER = 100;

function serialise(id: number, type: string, data: unknown): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function startSession(conversationId: string): Session {
  const existing = sessions.get(conversationId);
  if (existing && !existing.finished) return existing;
  const session: Session = { buffer: [], counter: 0, finished: false, writers: new Set() };
  sessions.set(conversationId, session);
  return session;
}

export function getSession(conversationId: string): Session | undefined {
  return sessions.get(conversationId);
}

// Writes an event: assigns the next id, buffers it (circular), fans out to writers.
export function pushEvent(conversationId: string, type: string, data: unknown) {
  const session = sessions.get(conversationId);
  if (!session) return;
  const id = ++session.counter;
  const payload = serialise(id, type, data);
  session.buffer.push({ id, payload });
  if (session.buffer.length > MAX_BUFFER) session.buffer.shift();
  for (const w of session.writers) {
    try { w(payload); } catch {}
  }
}

export function addWriter(conversationId: string, writer: Writer, lastEventId: number) {
  const session = sessions.get(conversationId);
  if (!session) return;
  // Replay any events the client missed.
  for (const ev of session.buffer) {
    if (ev.id > lastEventId) {
      try { writer(ev.payload); } catch {}
    }
  }
  if (!session.finished) session.writers.add(writer);
}

export function removeWriter(conversationId: string, writer: Writer) {
  sessions.get(conversationId)?.writers.delete(writer);
}

// Marks a session complete and schedules buffer cleanup after a grace window.
export function finishSession(conversationId: string) {
  const session = sessions.get(conversationId);
  if (!session) return;
  session.finished = true;
  session.writers.clear();
  setTimeout(() => sessions.delete(conversationId), 60_000);
}

export { type Session };
