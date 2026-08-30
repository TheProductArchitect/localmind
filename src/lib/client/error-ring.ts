/**
 * Tiny client-side ring buffer of recent runtime errors for improvement reports.
 * Nothing leaves the machine — only included when the user submits a report.
 */

const MAX = 24;
const buf: string[] = [];

function push(entry: string) {
  const line = entry.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!line) return;
  buf.push(`${new Date().toISOString()} ${line}`);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

let hooked = false;

/** Call once from the report dialog (or shell) to start capturing. */
export function ensureErrorRing() {
  if (typeof window === "undefined" || hooked) return;
  hooked = true;
  window.addEventListener("error", (ev) => {
    const msg = ev.message || String(ev.error || "error");
    const where = ev.filename ? ` @ ${ev.filename}:${ev.lineno || 0}` : "";
    push(`error: ${msg}${where}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason =
      ev.reason instanceof Error
        ? ev.reason.message
        : typeof ev.reason === "string"
          ? ev.reason
          : JSON.stringify(ev.reason);
    push(`unhandledrejection: ${reason}`);
  });
}

export function recentClientErrors(): string[] {
  return buf.slice();
}

export function recordClientError(message: string) {
  push(message);
}
