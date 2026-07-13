"use client";
import { useEffect, useRef, useState } from "react";
import { Orb } from "@/components/orb";

type Variant = "info" | "success" | "error";
type Toast = {
  id: number;
  key: string;
  message: string;
  variant: Variant;
  count: number;
  leaving: boolean;
};

let counter = 0;

export function toast(message: string, variant: Variant = "info") {
  window.dispatchEvent(new CustomEvent("localmind-toast", { detail: { message, variant } }));
}

const MAX_VISIBLE = 4;
const LIFETIME_MS = 4200;
const EXIT_MS = 260;

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const localTimers = timers.current;

    // Schedule a toast's graceful exit; resettable so a repeated (coalesced)
    // message keeps its full lifetime instead of vanishing early.
    function scheduleDismiss(id: number) {
      const existing = localTimers.get(id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setToasts((cur) => cur.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
        setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), EXIT_MS);
      }, LIFETIME_MS);
      localTimers.set(id, t);
    }

    function onToast(e: Event) {
      const { message, variant } = (e as CustomEvent).detail as { message: string; variant: Variant };
      const key = `${variant}:${message}`;
      setToasts((cur) => {
        // Coalesce a repeat of the same message into a single card with a count
        // (kills the "moved to trash ×8" spam) and refresh its lifetime.
        const match = cur.find((x) => x.key === key && !x.leaving);
        if (match) {
          scheduleDismiss(match.id);
          return cur.map((x) => (x.id === match.id ? { ...x, count: x.count + 1 } : x));
        }
        const id = ++counter;
        scheduleDismiss(id);
        let next = [...cur, { id, key, message, variant, count: 1, leaving: false }];
        // Cap the stack — retire the oldest active card so it stays calm.
        const active = next.filter((x) => !x.leaving);
        if (active.length > MAX_VISIBLE) {
          const oldest = active[0];
          const timer = localTimers.get(oldest.id);
          if (timer) clearTimeout(timer);
          setTimeout(() => setToasts((c) => c.filter((y) => y.id !== oldest.id)), EXIT_MS);
          next = next.map((x) => (x.id === oldest.id ? { ...x, leaving: true } : x));
        }
        return next;
      });
    }

    window.addEventListener("localmind-toast", onToast);
    return () => {
      window.removeEventListener("localmind-toast", onToast);
      localTimers.forEach((t) => clearTimeout(t));
      localTimers.clear();
    };
  }, []);

  return (
    <div className="lm-toaster" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="lm-toast" data-variant={t.variant} data-leaving={t.leaving}>
          <span className="lm-toast__orb">
            <Orb size={20} state={t.variant === "error" ? "error" : "idle"} />
          </span>
          <span className="lm-toast__msg">{t.message}</span>
          {t.count > 1 && <span className="lm-toast__count">×{t.count}</span>}
          <span className="lm-toast__life" style={{ animationDuration: `${LIFETIME_MS}ms` }} />
        </div>
      ))}

      <style jsx>{`
        .lm-toaster {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 50;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: none;
          max-width: min(380px, calc(100vw - 40px));
        }
        .lm-toast {
          position: relative;
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 14px 13px;
          border-radius: 14px;
          overflow: hidden;
          color: hsl(0 0% 100% / 0.92);
          background: hsl(234 22% 6% / 0.72);
          border: 1px solid hsl(0 0% 100% / 0.10);
          box-shadow:
            0 8px 32px hsl(234 40% 2% / 0.55),
            inset 0 0 0 1px hsl(0 0% 100% / 0.02);
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          animation: lm-toast-in 340ms cubic-bezier(0.16, 1, 0.3, 1) both;
          transform-origin: bottom right;
        }
        .lm-toast[data-leaving="true"] {
          animation: lm-toast-out ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1) both;
        }
        /* Variant accent — a hairline glow along the leading edge. */
        .lm-toast::before {
          content: "";
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 2px;
          background: hsl(0 0% 100% / 0.5);
          box-shadow: 0 0 12px hsl(0 0% 100% / 0.4);
        }
        .lm-toast[data-variant="success"]::before {
          background: hsl(152 70% 55%);
          box-shadow: 0 0 14px hsl(152 70% 55% / 0.7);
        }
        .lm-toast[data-variant="error"]::before {
          background: hsl(0 90% 68%);
          box-shadow: 0 0 14px hsl(0 90% 68% / 0.75);
        }
        .lm-toast__orb { flex-shrink: 0; display: inline-flex; }
        .lm-toast__msg {
          flex: 1;
          font-size: 13px;
          line-height: 1.4;
          letter-spacing: -0.005em;
        }
        .lm-toast__count {
          flex-shrink: 0;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: hsl(0 0% 100% / 0.6);
          background: hsl(0 0% 100% / 0.08);
          border: 1px solid hsl(0 0% 100% / 0.12);
          border-radius: 999px;
          padding: 1px 7px;
        }
        /* Lifetime bar — a quiet visualization of how long the toast lingers. */
        .lm-toast__life {
          position: absolute;
          left: 0; bottom: 0;
          height: 2px;
          width: 100%;
          transform-origin: left center;
          background: linear-gradient(90deg, hsl(0 0% 100% / 0.05), hsl(0 0% 100% / 0.35));
          animation-name: lm-toast-life;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        .lm-toast[data-variant="error"] .lm-toast__life {
          background: linear-gradient(90deg, hsl(0 90% 68% / 0.1), hsl(0 90% 68% / 0.5));
        }
        .lm-toast[data-variant="success"] .lm-toast__life {
          background: linear-gradient(90deg, hsl(152 70% 55% / 0.1), hsl(152 70% 55% / 0.5));
        }

        @keyframes lm-toast-in {
          from { opacity: 0; transform: translateX(24px) scale(0.96); filter: blur(6px); }
          to   { opacity: 1; transform: translateX(0)    scale(1);    filter: blur(0); }
        }
        @keyframes lm-toast-out {
          from { opacity: 1; transform: translateX(0)    scale(1); }
          to   { opacity: 0; transform: translateX(24px) scale(0.96); }
        }
        @keyframes lm-toast-life {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lm-toast { animation: none; }
          .lm-toast__life { display: none; }
        }
      `}</style>
    </div>
  );
}
