"use client";

/**
 * <EdgePulse/> — element-aware light tracing (latency-safe).
 *
 * Click handler stays tiny: closest() + schedule. Heavy work runs on the next
 * animation frame so navigation / button handlers are never blocked.
 * No permanent rAF when idle; no per-pulse <style jsx> injection.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

type Style = {
  durationMs: number;
  segmentRatio: number;
  strokeWidth: number;
  intensity: number;
  tone?: "white" | "danger" | "warm";
  pattern?: "trace" | "double" | "burst";
};

type PathSpec = { d: string; approxLength: number };

type Pulse = {
  id: number;
  originX: number;
  originY: number;
  paths: PathSpec[];
  style: Style;
  triggerRef: WeakRef<HTMLElement>;
};

const MAX_PULSES = 3;
const MIN_INTERVAL_MS = 80;

const PULSE_SELECTOR =
  "button, a[href], [role='button'], [role='link'], [role='menuitem'], [data-pulse='true']";
const SUPPRESS_SELECTOR = "input, textarea, select, [data-pulse='false']";

const STYLE_PRESETS: Record<string, Style> = {
  primary: { durationMs: 900, segmentRatio: 0.34, strokeWidth: 1.5, intensity: 1.0 },
  ghost: { durationMs: 750, segmentRatio: 0.28, strokeWidth: 1.15, intensity: 0.78 },
  icon: { durationMs: 650, segmentRatio: 0.4, strokeWidth: 1.0, intensity: 0.8 },
  rail: { durationMs: 480, segmentRatio: 0.32, strokeWidth: 1.0, intensity: 0.65 },
  subtle: { durationMs: 600, segmentRatio: 0.25, strokeWidth: 1.0, intensity: 0.5 },
};

const ACTION_PRESETS: Record<string, Partial<Style>> = {
  send: { durationMs: 900, segmentRatio: 0.4, intensity: 1.0, pattern: "trace" },
  save: { durationMs: 800, segmentRatio: 0.2, intensity: 0.9, pattern: "double", tone: "warm" },
  destructive: { durationMs: 700, segmentRatio: 0.28, intensity: 1.0, tone: "danger" },
  search: { durationMs: 800, segmentRatio: 0.35, intensity: 0.85 },
  spawn: { durationMs: 900, segmentRatio: 0.18, intensity: 0.9, pattern: "burst" },
  confirm: { durationMs: 800, segmentRatio: 0.22, intensity: 0.92, pattern: "double" },
  cancel: { durationMs: 500, segmentRatio: 0.22, intensity: 0.5 },
};

function parseRgbaAlpha(color: string): number {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map((s) => s.trim());
  if (parts.length === 4) return Number(parts[3]);
  return 1;
}

function classifyStyle(el: HTMLElement): Style {
  const forced = el.getAttribute("data-pulse-style");
  const action = el.getAttribute("data-pulse-action");
  let base: Style;
  if (forced && STYLE_PRESETS[forced]) {
    base = { ...STYLE_PRESETS[forced] };
  } else if (el.classList.contains("lm-rail-link")) {
    base = { ...STYLE_PRESETS.rail };
  } else {
    const computed = window.getComputedStyle(el);
    const bgAlpha = parseRgbaAlpha(computed.backgroundColor);
    const hasBorder =
      parseFloat(computed.borderTopWidth) > 0 &&
      !computed.borderTopColor.includes("rgba(0, 0, 0, 0)");
    if (bgAlpha >= 0.85) base = { ...STYLE_PRESETS.primary };
    else if (bgAlpha > 0.04 || hasBorder) base = { ...STYLE_PRESETS.ghost };
    else base = { ...STYLE_PRESETS.icon };
  }
  if (action && ACTION_PRESETS[action]) Object.assign(base, ACTION_PRESETS[action]);
  return base;
}

function rectPathD(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rr <= 0.5) return `M0,0 H${w} V${h} H0 Z`;
  return [
    `M${rr},0`,
    `H${w - rr}`,
    `Q${w},0 ${w},${rr}`,
    `V${h - rr}`,
    `Q${w},${h} ${w - rr},${h}`,
    `H${rr}`,
    `Q0,${h} 0,${h - rr}`,
    `V${rr}`,
    `Q0,0 ${rr},0`,
    "Z",
  ].join(" ");
}

function strokeColor(tone?: Style["tone"]): string {
  if (tone === "danger") return "hsl(0 90% 72%)";
  if (tone === "warm") return "hsl(36 90% 72%)";
  return "hsl(0 0% 100%)";
}

function glowColor(tone?: Style["tone"]): string {
  if (tone === "danger") return "hsl(0 90% 60%)";
  if (tone === "warm") return "hsl(36 90% 58%)";
  return "hsl(0 0% 100%)";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

function buildPulse(trigger: HTMLElement): Pulse | null {
  const rect = trigger.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  const style = classifyStyle(trigger);
  // Cheap path only — skip SVG sampling on the click path (was a major stall).
  const computed = window.getComputedStyle(trigger);
  const rawRadius = parseFloat(computed.borderRadius) || 0;
  const r = Math.max(0, Math.min(rawRadius, Math.min(rect.width, rect.height) / 2));
  const d = rectPathD(rect.width, rect.height, r);
  return {
    id: 0,
    originX: rect.left,
    originY: rect.top,
    paths: [{ d, approxLength: 2 * (rect.width + rect.height) }],
    style,
    triggerRef: new WeakRef(trigger),
  };
}

export function EdgePulse() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const idRef = useRef(0);
  const lastFireRef = useRef(0);
  const aliveRef = useRef(false);

  // rAF only while pulses are alive — cancel detached triggers.
  useEffect(() => {
    if (pulses.length === 0) {
      aliveRef.current = false;
      return;
    }
    aliveRef.current = true;
    let raf = 0;
    const tick = () => {
      if (!aliveRef.current) return;
      setPulses((cur) => {
        if (cur.length === 0) return cur;
        const next = cur.filter((p) => {
          const el = p.triggerRef.deref();
          return el && el.isConnected;
        });
        return next.length === cur.length ? cur : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [pulses.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (prefersReducedMotion()) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const trigger = target.closest(PULSE_SELECTOR) as HTMLElement | null;
      if (!trigger) return;
      if (trigger.matches(SUPPRESS_SELECTOR) || target.closest(SUPPRESS_SELECTOR)) return;
      if (
        (trigger as HTMLButtonElement).disabled ||
        trigger.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      const now = performance.now();
      if (now - lastFireRef.current < MIN_INTERVAL_MS) return;
      lastFireRef.current = now;

      // Defer all measurement/state off the click critical path.
      requestAnimationFrame(() => {
        const pulse = buildPulse(trigger);
        if (!pulse) return;
        const id = ++idRef.current;
        pulse.id = id;
        setPulses((prev) => {
          const trimmed = prev.length >= MAX_PULSES ? prev.slice(-MAX_PULSES + 1) : prev;
          return [...trimmed, pulse];
        });
        window.setTimeout(() => {
          setPulses((prev) => prev.filter((p) => p.id !== id));
        }, pulse.style.durationMs + 80);

        if (typeof localStorage !== "undefined" && localStorage.getItem("lm_perf") === "1") {
          const dt = performance.now() - now;
          // eslint-disable-next-line no-console
          console.debug(`[lm_perf] edge-pulse schedule ${dt.toFixed(1)}ms`);
        }
      });
    }

    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener(
        "click",
        onClick,
        { capture: true } as unknown as AddEventListenerOptions
      );
  }, []);

  if (pulses.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 60,
        overflow: "visible",
      }}
    >
      {pulses.map((p) => (
        <PulseGroup key={p.id} pulse={p} />
      ))}
    </svg>
  );
}

function PulseGroup({ pulse }: { pulse: Pulse }) {
  const { originX, originY, paths, style } = pulse;
  const pattern = style.pattern ?? "trace";
  const phases =
    pattern === "double" ? [0, 0.5] : pattern === "burst" ? [0, 0.18, 0.36] : [0];

  return (
    <g transform={`translate(${originX},${originY})`}>
      {paths.flatMap((p, i) =>
        phases.map((phase, j) => (
          <PulseStroke
            key={`${i}-${j}`}
            d={p.d}
            length={p.approxLength}
            style={style}
            phase={phase}
          />
        ))
      )}
    </g>
  );
}

function PulseStroke({
  d,
  length,
  style,
  phase,
}: {
  d: string;
  length: number;
  style: Style;
  phase: number;
}) {
  const segmentLen = Math.max(8, length * style.segmentRatio);
  const fromOffset = length + phase * length;
  const toOffset = phase * length;
  const a = (v: number) => Math.min(1, v * style.intensity);
  const stroke = strokeColor(style.tone);
  const glowHsl = glowColor(style.tone);
  const glow = style.intensity;

  return (
    <path
      className="lm-edge-stroke"
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={style.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={
        {
          strokeDasharray: `${segmentLen} ${Math.max(1, length - segmentLen)}`,
          filter: `drop-shadow(0 0 ${2 + glow * 3}px ${glowHsl} / ${0.45 * glow}))`,
          animation: `lm-edge-trace ${style.durationMs}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
          animationDelay: `${phase * 40}ms`,
          opacity: 0,
          ["--lm-edge-from" as string]: String(fromOffset),
          ["--lm-edge-to" as string]: String(toOffset),
          ["--lm-edge-op-peak" as string]: String(a(0.95)),
          ["--lm-edge-op-mid" as string]: String(a(0.6)),
        } as CSSProperties
      }
    />
  );
}
