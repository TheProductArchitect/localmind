/**
 * Lamport clock for cross-node ordering of audit events.
 *
 * Real wall-clock timestamps are fine for sorting per-node but unreliable across
 * machines (drift, NTP misbehaviour, timezones). Lamport clocks give a partial
 * order that's monotonic for any pair of causally-related events:
 *
 *   - Every local event increments the counter.
 *   - When receiving a signed envelope with `lamport=N`, the local counter
 *     advances to max(local, N) + 1 before any new local event is stamped.
 *
 * The clock is persisted in the single-row `node_clock` table so it survives
 * restarts. All updates run inside a transaction so concurrent ticks can't
 * skip values.
 */

import { getConfigDb } from "../db";

/** Atomically advance and return the next Lamport counter value. */
export function tick(): number {
  const db = getConfigDb();
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT counter FROM node_clock WHERE id = 1").get() as
      | { counter: number }
      | undefined;
    const next = (row?.counter ?? 0) + 1;
    db.prepare("UPDATE node_clock SET counter = ? WHERE id = 1").run(next);
    return next;
  });
  return tx();
}

/**
 * Advance the clock to at least `incoming + 1` and return the new value.
 * Call this on every received signed envelope before recording any local
 * event linked to that envelope.
 */
export function observe(incoming: number): number {
  if (!Number.isInteger(incoming) || incoming < 0) {
    throw new Error(`Invalid incoming Lamport value: ${incoming}`);
  }
  const db = getConfigDb();
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT counter FROM node_clock WHERE id = 1").get() as
      | { counter: number }
      | undefined;
    const next = Math.max(row?.counter ?? 0, incoming) + 1;
    db.prepare("UPDATE node_clock SET counter = ? WHERE id = 1").run(next);
    return next;
  });
  return tx();
}

/** Read the current counter without advancing it. */
export function peek(): number {
  const row = getConfigDb()
    .prepare("SELECT counter FROM node_clock WHERE id = 1")
    .get() as { counter: number } | undefined;
  return row?.counter ?? 0;
}
