/**
 * Coalesce streaming text deltas onto the next animation frame so React
 * re-renders ~once per frame instead of once per token. That is the main
 * difference between a jumpy stream and a smooth one.
 */

export type StreamFlusher = (delta: string) => void;

export function createStreamBatcher(flush: StreamFlusher) {
  let pending = "";
  let raf = 0;

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const chunk = pending;
      pending = "";
      if (chunk) flush(chunk);
    });
  };

  return {
    push(delta: string) {
      if (!delta) return;
      pending += delta;
      schedule();
    },
    /** Force any buffered tokens into the UI before a non-text event. */
    flushNow() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const chunk = pending;
      pending = "";
      if (chunk) flush(chunk);
    },
    clear() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pending = "";
    },
  };
}
