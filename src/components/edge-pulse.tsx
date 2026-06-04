"use client";

/**
 * <EdgePulse/> — element-aware light tracing.
 *
 * Each interaction lights up the perimeter of the element the user just
 * touched. The animation parameters (speed, intensity, stroke weight,
 * segment length) are tuned dynamically to what the element is:
 *
 *   primary CTA (filled, opaque background)
 *     → slow, bright, thick stroke, long trail. "This action matters."
 *   ghost / outline button (subtle bg, with a border)
 *     → medium speed, medium intensity, normal stroke
 *   icon-only / link (no background, just text or an SVG)
 *     → fast, dim, thin stroke. The light hugs the SVG's actual path
 *       instead of a bounding rect, so a Mic icon traces around the mic,
 *       not around an imaginary square.
 *   rail / nav glyph
 *     → quick, snappy, very subtle
 *
 * Authors can override the auto-classification with two attributes:
 *
 *   data-pulse-style="primary | ghost | icon | rail | subtle"
 *   data-pulse-trace="rect | svg | auto"  — force tracing strategy
 *
 * Together with <Orb/>, this is the entire decorative motion vocabulary
 * in LocalMind. Same white luminance, same easing curve — different
 * intensities tuned to the importance of the action.
 */

import { useEffect, useRef, useState } from "react";

type Style = {
  durationMs: number;
  segmentRatio: number;   // bright dash as fraction of perimeter
  strokeWidth: number;
  intensity: number;      // 0..1, modulates opacity + glow
};

type PathSpec = {
  // Path "d" string in the element's local coordinates (origin at element's
  // top-left in viewport coords + offsetX/Y for SVG icons).
  d: string;
  approxLength: number;
};

type Pulse = {
  id: number;
  originX: number;       // viewport-space group offset
  originY: number;
  paths: PathSpec[];
  style: Style;
  startOffset: number;   // 0..1 — where on the (combined) path the trail begins
};

const MAX_PULSES = 8;
const MIN_INTERVAL_MS = 60;

const PULSE_SELECTOR =
  "button, a[href], [role='button'], [role='link'], [role='menuitem'], [data-pulse='true']";
const SUPPRESS_SELECTOR = "input, textarea, select, [data-pulse='false']";

const STYLE_PRESETS: Record<string, Style> = {
  primary: { durationMs: 1300, segmentRatio: 0.34, strokeWidth: 1.6, intensity: 1.0  },
  ghost:   { durationMs: 1050, segmentRatio: 0.28, strokeWidth: 1.2, intensity: 0.78 },
  icon:    { durationMs:  900, segmentRatio: 0.42, strokeWidth: 1.1, intensity: 0.85 },
  rail:    { durationMs:  780, segmentRatio: 0.35, strokeWidth: 1.0, intensity: 0.72 },
  subtle:  { durationMs:  900, segmentRatio: 0.25, strokeWidth: 1.0, intensity: 0.55 },
};

function parseRgbaAlpha(css: string): number {
  // Computed bg returns formats like "rgb(0, 0, 0)" (opaque) or
  // "rgba(255, 255, 255, 0.08)". Anything that isn't rgba(...) is treated as
  // opaque (alpha=1). "transparent" → alpha 0.
  if (!css || css === "transparent") return 0;
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map((p) => p.trim());
  if (parts.length < 4) return 1;
  const a = Number(parts[3]);
  return Number.isFinite(a) ? a : 1;
}

function classifyStyle(trigger: HTMLElement): Style {
  const explicit = trigger.getAttribute("data-pulse-style");
  if (explicit && STYLE_PRESETS[explicit]) return STYLE_PRESETS[explicit];

  // Rail items expose this className from the Rail component.
  if (trigger.classList.contains("lm-rail-link")) return STYLE_PRESETS.rail;

  const computed = window.getComputedStyle(trigger);
  const bgAlpha = parseRgbaAlpha(computed.backgroundColor);
  const hasBorder =
    parseFloat(computed.borderTopWidth) > 0 &&
    !computed.borderTopColor.includes("rgba(0, 0, 0, 0)");

  const hasOwnText = (trigger.textContent || "").trim().length > 0;
  const onlySvg = !hasOwnText && !!trigger.querySelector("svg");

  if (bgAlpha >= 0.6) return STYLE_PRESETS.primary;
  if (bgAlpha >= 0.05 || hasBorder) return STYLE_PRESETS.ghost;
  if (onlySvg) return STYLE_PRESETS.icon;
  return STYLE_PRESETS.subtle;
}

/** Returns a rounded-rect "d" string in local coords (0..w, 0..h). */
function rectPathD(w: number, h: number, r: number): string {
  return (
    `M ${r} 0` +
    ` L ${w - r} 0 Q ${w} 0 ${w} ${r}` +
    ` L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h}` +
    ` L ${r} ${h} Q 0 ${h} 0 ${h - r}` +
    ` L 0 ${r} Q 0 0 ${r} 0 Z`
  );
}

/**
 * For an SVG icon inside the trigger, copy its visible path data into our
 * overlay. We support <path>, <circle>, <rect>, <line>, <polyline>, and
 * <polygon> — the shapes lucide-react uses. Each shape is converted to a
 * path "d" string in the overlay's own coordinate system so a single
 * <path> in the overlay can render any source shape with one
 * stroke-dashoffset animation.
 */
function extractSvgPaths(svg: SVGElement, hostRect: DOMRect): PathSpec[] {
  const svgRect = svg.getBoundingClientRect();
  // Translate from the SVG element's own bounding rect into the host
  // element's local frame (the overlay group is positioned at the host's
  // top-left).
  const offX = svgRect.left - hostRect.left;
  const offY = svgRect.top - hostRect.top;

  const vb = svg.getAttribute("viewBox");
  let scaleX = 1, scaleY = 1, vbX = 0, vbY = 0;
  if (vb) {
    const parts = vb.split(/\s+|,/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [vbX, vbY] = [parts[0], parts[1]];
      scaleX = svgRect.width / parts[2];
      scaleY = svgRect.height / parts[3];
    }
  }
  const mapX = (x: number) => offX + (x - vbX) * scaleX;
  const mapY = (y: number) => offY + (y - vbY) * scaleY;

  const paths: PathSpec[] = [];
  const shapes = svg.querySelectorAll("path, circle, rect, line, polyline, polygon");
  shapes.forEach((el) => {
    let d = "";
    let approx = 0;
    const tag = el.tagName.toLowerCase();
    if (tag === "path") {
      // Transform the path's coordinates by re-using its existing geometry
      // via getTotalLength()/getPointAtLength sampling. This handles arcs,
      // bezier curves, and complex commands without re-implementing SVG.
      const p = el as SVGPathElement;
      try {
        const total = p.getTotalLength();
        const steps = Math.max(24, Math.min(160, Math.round(total / 1.5)));
        const pts: string[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * total;
          const pt = p.getPointAtLength(t);
          pts.push(`${mapX(pt.x).toFixed(2)} ${mapY(pt.y).toFixed(2)}`);
        }
        if (pts.length > 1) {
          d = "M " + pts[0] + pts.slice(1).map((s) => " L " + s).join("");
          approx = total * Math.min(scaleX, scaleY);
        }
      } catch { /* SVG path API may not be available — fall through */ }
    } else if (tag === "circle") {
      const cx = Number(el.getAttribute("cx") || "0");
      const cy = Number(el.getAttribute("cy") || "0");
      const r  = Number(el.getAttribute("r")  || "0");
      const x = mapX(cx), y = mapY(cy);
      const rx = r * scaleX, ry = r * scaleY;
      d = `M ${x - rx} ${y} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
      approx = 2 * Math.PI * ((rx + ry) / 2);
    } else if (tag === "rect") {
      const rx = Number(el.getAttribute("x") || "0");
      const ry = Number(el.getAttribute("y") || "0");
      const w  = Number(el.getAttribute("width")  || "0");
      const h  = Number(el.getAttribute("height") || "0");
      const r0 = Number(el.getAttribute("rx") || "0");
      const x0 = mapX(rx), y0 = mapY(ry);
      const x1 = mapX(rx + w), y1 = mapY(ry + h);
      const rr = r0 * Math.min(scaleX, scaleY);
      d =
        `M ${x0 + rr} ${y0}` +
        ` L ${x1 - rr} ${y0} Q ${x1} ${y0} ${x1} ${y0 + rr}` +
        ` L ${x1} ${y1 - rr} Q ${x1} ${y1} ${x1 - rr} ${y1}` +
        ` L ${x0 + rr} ${y1} Q ${x0} ${y1} ${x0} ${y1 - rr}` +
        ` L ${x0} ${y0 + rr} Q ${x0} ${y0} ${x0 + rr} ${y0} Z`;
      approx = 2 * ((x1 - x0) + (y1 - y0));
    } else if (tag === "line") {
      const x1 = Number(el.getAttribute("x1") || "0");
      const y1 = Number(el.getAttribute("y1") || "0");
      const x2 = Number(el.getAttribute("x2") || "0");
      const y2 = Number(el.getAttribute("y2") || "0");
      const a = { x: mapX(x1), y: mapY(y1) };
      const b = { x: mapX(x2), y: mapY(y2) };
      d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      approx = Math.hypot(b.x - a.x, b.y - a.y);
    } else if (tag === "polyline" || tag === "polygon") {
      const pts = (el.getAttribute("points") || "")
        .trim()
        .split(/\s+|,/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (pts.length >= 4) {
        const xs: number[] = [], ys: number[] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) { xs.push(mapX(pts[i])); ys.push(mapY(pts[i + 1])); }
        d = "M " + xs[0] + " " + ys[0] +
            xs.slice(1).map((x, i) => ` L ${x} ${ys[i + 1]}`).join("");
        if (tag === "polygon") d += " Z";
        for (let i = 1; i < xs.length; i++) approx += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      }
    }
    if (d && approx > 4) paths.push({ d, approxLength: approx });
  });
  return paths;
}

export function EdgePulse() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const idRef = useRef(0);
  const lastFireRef = useRef(0);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const trigger = target.closest(PULSE_SELECTOR) as HTMLElement | null;
      if (!trigger) return;
      if (trigger.matches(SUPPRESS_SELECTOR) || target.closest(SUPPRESS_SELECTOR)) return;
      if (
        (trigger as HTMLButtonElement).disabled ||
        trigger.getAttribute("aria-disabled") === "true"
      ) return;

      const now = performance.now();
      if (now - lastFireRef.current < MIN_INTERVAL_MS) return;
      lastFireRef.current = now;

      const rect = trigger.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;

      const style = classifyStyle(trigger);
      const computed = window.getComputedStyle(trigger);
      const bgAlpha = parseRgbaAlpha(computed.backgroundColor);
      const hasBorder = parseFloat(computed.borderTopWidth) > 0 &&
        !computed.borderTopColor.includes("rgba(0, 0, 0, 0)");
      const traceAttr = trigger.getAttribute("data-pulse-trace");

      let paths: PathSpec[] = [];
      const wantsSvg =
        traceAttr === "svg" ||
        (traceAttr !== "rect" && bgAlpha < 0.04 && !hasBorder);

      if (wantsSvg) {
        const svg = trigger.querySelector("svg") as SVGElement | null;
        if (svg) {
          paths = extractSvgPaths(svg, rect);
        }
      }
      if (paths.length === 0) {
        // Fall back to the element's rounded-rect perimeter.
        const rawRadius = parseFloat(computed.borderRadius) || 0;
        const r = Math.max(0, Math.min(rawRadius, Math.min(rect.width, rect.height) / 2));
        const d = rectPathD(rect.width, rect.height, r);
        paths = [{ d, approxLength: 2 * (rect.width + rect.height) }];
      }

      const id = ++idRef.current;
      const next: Pulse = {
        id,
        originX: rect.left,
        originY: rect.top,
        paths,
        style,
        // Pulses always start at the path's natural origin (top-left for
        // rects, first vertex for SVGs). Clicking at a particular point of
        // an icon doesn't shift the trail start — the trace is about the
        // shape, not the click coordinate.
        startOffset: 0,
      };

      setPulses((prev) => {
        const trimmed = prev.length >= MAX_PULSES ? prev.slice(-MAX_PULSES + 1) : prev;
        return [...trimmed, next];
      });
      window.setTimeout(() => {
        setPulses((prev) => prev.filter((p) => p.id !== id));
      }, style.durationMs + 120);
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as unknown as AddEventListenerOptions);
  }, []);

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
        mixBlendMode: "screen",
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
  return (
    <g transform={`translate(${originX},${originY})`}>
      {paths.map((p, i) => (
        <PulseStroke key={i} index={pulse.id * 100 + i} d={p.d} length={p.approxLength} style={style} />
      ))}
    </g>
  );
}

function PulseStroke({
  index, d, length, style,
}: { index: number; d: string; length: number; style: Style }) {
  const segmentLen = Math.max(8, length * style.segmentRatio);
  const fromOffset = length;
  const toOffset = 0;
  const animName = `lm-trace-${index}`;
  const glow = style.intensity;
  const a = (v: number) => Math.min(1, v * style.intensity);

  return (
    <>
      <path
        d={d}
        fill="none"
        stroke="white"
        strokeWidth={style.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: `${segmentLen} ${length - segmentLen}`,
          strokeDashoffset: fromOffset,
          filter: `drop-shadow(0 0 ${3 + glow * 4}px hsl(0 0% 100% / ${0.45 * glow})) drop-shadow(0 0 ${8 + glow * 8}px hsl(0 0% 100% / ${0.22 * glow}))`,
          animation: `${animName} ${style.durationMs}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
          opacity: 0,
        }}
      />
      <style jsx>{`
        @keyframes ${animName} {
          0%   { stroke-dashoffset: ${fromOffset}; opacity: 0; }
          10%  { opacity: ${a(0.95)}; }
          75%  { opacity: ${a(0.65)}; }
          100% { stroke-dashoffset: ${toOffset}; opacity: 0; }
        }
      `}</style>
    </>
  );
}
