"use client";

/**
 * Mono glass confirm dialog — replaces window.confirm for destructive/admin
 * actions so the product stays in the v2 visual system.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "…", message: "…" }))) return;
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Maps to destructive EdgePulse tone on the confirm button */
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) {
    // Fallback when provider is missing (tests / early render)
    return async (opts) =>
      typeof window !== "undefined" ? window.confirm(`${opts.title}\n\n${opts.message}`) : false;
  }
  return fn;
}

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      seq.current += 1;
      setPending({ ...opts, resolve });
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    setPending((cur) => {
      cur?.resolve(value);
      return null;
    });
  }, []);

  // Escape cancels — same result as clicking the backdrop.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, finish]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6 lm-overlay-in"
          style={{ background: "hsl(234 22% 2% / 0.55)", backdropFilter: "blur(8px)" }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="lm-confirm-title"
          aria-describedby="lm-confirm-desc"
          onClick={() => finish(false)}
        >
          <div
            className="w-full max-w-md lm-panel-in"
            style={{
              background: "hsl(234 18% 7% / 0.94)",
              border: "1px solid hsl(0 0% 100% / 0.12)",
              borderRadius: 14,
              boxShadow: "0 24px 80px hsl(0 0% 0% / 0.55), 0 0 0 1px hsl(0 0% 100% / 0.04) inset",
              padding: "20px 22px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="lm-micro mb-2">Confirm</p>
            <h2 id="lm-confirm-title" className="lm-display" style={{ fontSize: 22, lineHeight: "28px" }}>
              {pending.title}
            </h2>
            <p
              id="lm-confirm-desc"
              className="lm-body mt-3"
              style={{ color: "hsl(0 0% 100% / 0.55)" }}
            >
              {pending.message}
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="lm-action lm-action--ghost"
                onClick={() => finish(false)}
                data-pulse="true"
              >
                {pending.cancelLabel || "Cancel"}
              </button>
              <button
                type="button"
                className="lm-action"
                onClick={() => finish(true)}
                data-pulse="true"
                data-pulse-action={pending.destructive ? "destructive" : "save"}
                autoFocus
              >
                {pending.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
