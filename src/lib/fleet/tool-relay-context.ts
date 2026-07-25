/**
 * AsyncLocalStorage plumbing for "tool home = initiator" chat relays.
 *
 * Two independent flags, both scoped to a single async run:
 *
 *   1. Outbound routing (EXECUTOR side, e.g. the DGX hub): while running an
 *      inbound chat-relay whose `tool_home = initiator`, allowlisted personal-
 *      assistant tools should execute back on the initiator's device instead
 *      of the executor's. `getToolHome()` tells the tool-cache wrapper where.
 *
 *   2. Inbound guard (INITIATOR side, e.g. the user's PC): while handling an
 *      inbound tool-relay we run the tool locally and must NOT re-relay it
 *      (would loop executor -> initiator -> executor). `isToolRelayInbound()`.
 */

import { AsyncLocalStorage } from "async_hooks";

type ToolHome = { initiatorNodeId: string; conversationId?: string | null };

const outbound = new AsyncLocalStorage<ToolHome>();
const inbound = new AsyncLocalStorage<{ inbound: true }>();

export function runWithToolHome<T>(home: ToolHome, fn: () => Promise<T>): Promise<T> {
  return outbound.run(home, fn);
}

export function getToolHome(): ToolHome | null {
  return outbound.getStore() ?? null;
}

export function runAsToolRelayInbound<T>(fn: () => Promise<T>): Promise<T> {
  return inbound.run({ inbound: true }, fn);
}

export function isToolRelayInbound(): boolean {
  return inbound.getStore()?.inbound === true;
}
