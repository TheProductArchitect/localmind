/**
 * In-memory registry of running agent processes. Cancellation flips the abort
 * controller; pause/resume sets a flag the agent loop can observe between
 * iterations. The registry is process-local — across app restarts, the reaper
 * in agent-processes.ts cleans up zombies.
 */
type Entry = {
  abort: AbortController;
  pauseFlag: { paused: boolean };
};

const REGISTRY = new Map<string, Entry>();

export function registerProcess(processId: string, abort: AbortController): { paused: () => boolean } {
  const entry: Entry = { abort, pauseFlag: { paused: false } };
  REGISTRY.set(processId, entry);
  return { paused: () => entry.pauseFlag.paused };
}

export function unregisterProcess(processId: string): void {
  REGISTRY.delete(processId);
}

export function cancelProcess(processId: string): boolean {
  const e = REGISTRY.get(processId);
  if (!e) return false;
  e.abort.abort();
  return true;
}

export function pauseProcess(processId: string): boolean {
  const e = REGISTRY.get(processId);
  if (!e) return false;
  e.pauseFlag.paused = true;
  return true;
}

export function resumeProcess(processId: string): boolean {
  const e = REGISTRY.get(processId);
  if (!e) return false;
  e.pauseFlag.paused = false;
  return true;
}

export function isRegistered(processId: string): boolean {
  return REGISTRY.has(processId);
}
