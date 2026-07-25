/**
 * AsyncLocalStorage flag so inbound workspace-relay handlers execute tools
 * locally without re-relaying (would loop A→B→A).
 */

import { AsyncLocalStorage } from "async_hooks";

type Store = { inbound: true };

const als = new AsyncLocalStorage<Store>();

export function runAsWorkspaceRelayInbound<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ inbound: true }, fn);
}

export function isWorkspaceRelayInbound(): boolean {
  return als.getStore()?.inbound === true;
}
