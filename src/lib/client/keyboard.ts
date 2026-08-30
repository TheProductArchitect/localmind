import type { KeyboardEvent } from "react";

/**
 * Keyboard activation for rows that behave like buttons (conversation rows,
 * note items, table cards). Pair with `role="button"` and `tabIndex={0}`.
 */
export function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Let nested controls (star, delete) handle their own keys.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    fn();
  };
}
