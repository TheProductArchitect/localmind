"use client";

/**
 * <Orb/> — the single decorative motion primitive in LocalMind v2.
 *
 * Every "living" visual signal in the product is expressed through this
 * component. No other element pulses, orbits, or glows on its own. The orb
 * carries the entire "futuristic agents" identity through one disciplined
 * vocabulary:
 *
 *   idle       — soft white core, slow breathing
 *   thinking   — luminance ramps up, halo expands
 *   tool       — a satellite detaches and drifts out, then dissolves
 *   spawn      — N satellites orbit the core
 *   error      — one sharp pulse, returns to idle
 *   suspended  — still and dim, single hairline ring (loop-guard)
 *
 * The component is intentionally implemented in pure CSS (no JS animation
 * loops) so it is cheap, GPU-accelerated, and respects prefers-reduced-motion
 * via the global rule in globals.css.
 */

import { cn } from "@/lib/utils";

export type OrbState =
  | "idle"
  | "thinking"
  | "tool"
  | "spawn"
  | "error"
  | "suspended";

export interface OrbProps {
  state?: OrbState;
  /** Pixel size of the orb's outer halo box. Core scales proportionally. */
  size?: number;
  /** Number of orbiting satellites when state === "spawn". Clamped 1..6. */
  satellites?: number;
  className?: string;
  /** Decorative only — pass a label to expose state to AT users. */
  ariaLabel?: string;
}

export function Orb({
  state = "idle",
  size = 64,
  satellites = 3,
  className,
  ariaLabel,
}: OrbProps) {
  const n = Math.max(1, Math.min(satellites, 6));
  const dots = Array.from({ length: n });
  const orbitRadius = size * 0.42;

  return (
    <div
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      data-state={state}
      className={cn("lm-orb", className)}
      style={{ width: size, height: size }}
    >
      {/* Outer halo — luminance changes per state */}
      <span className="lm-orb__halo" />
      {/* Inner core */}
      <span className="lm-orb__core" />
      {/* Suspended ring (only visible in suspended state) */}
      <span className="lm-orb__ring" />
      {/* Tool-call satellite (single, detaches) */}
      <span className="lm-orb__tool" />
      {/* Spawn satellites — rendered always but only visible in spawn state */}
      {/* Thinking-state rotating arc — the clearest motion signal for "Sora
          is processing." Two counter-rotating arcs make the orb read as
          alive at a glance, even at the 28px Rail size. */}
      <span className="lm-orb__arc lm-orb__arc--a" aria-hidden="true" />
      <span className="lm-orb__arc lm-orb__arc--b" aria-hidden="true" />
      {state === "spawn" &&
        dots.map((_, i) => (
          <span
            key={i}
            className="lm-orb__sat"
            style={{
              ["--lm-orb-angle" as string]: `${(360 / n) * i}deg`,
              ["--lm-orb-radius" as string]: `${orbitRadius}px`,
              ["--lm-orb-scale" as string]: `${0.7 + (i % 2) * 0.2}`,
              animationDelay: `${(i / n) * -6}s`,
            }}
          />
        ))}

      <style jsx>{`
        .lm-orb {
          position: relative;
          display: inline-block;
          isolation: isolate;
          contain: layout style;
        }
        .lm-orb__halo,
        .lm-orb__core,
        .lm-orb__ring,
        .lm-orb__tool,
        .lm-orb__sat {
          position: absolute;
          left: 50%;
          top: 50%;
          border-radius: 9999px;
          pointer-events: none;
          transform-origin: center;
        }

        /* HALO — barely-there outer luminance in idle, dramatic when thinking */
        .lm-orb__halo {
          width: 100%;
          height: 100%;
          transform: translate(-50%, -50%);
          background: radial-gradient(
            circle,
            hsl(0 0% 100% / 0.10) 0%,
            hsl(0 0% 100% / 0.03) 50%,
            transparent 75%
          );
          filter: blur(2px);
          opacity: 0.5;
          animation: lm-breathe-slow 6s ease-in-out infinite;
        }

        /* CORE — quiet dim nucleus at rest, no shadow */
        .lm-orb__core {
          width: 32%;
          height: 32%;
          transform: translate(-50%, -50%);
          background: radial-gradient(
            circle,
            hsl(0 0% 100% / 0.55) 0%,
            hsl(0 0% 100% / 0.25) 60%,
            hsl(0 0% 100% / 0.05) 100%
          );
          animation: lm-breathe-slow 6s ease-in-out infinite;
        }

        /* ARCS — hidden by default, the "thinking" signal */
        .lm-orb__arc {
          width: 78%;
          height: 78%;
          transform: translate(-50%, -50%);
          border-radius: 9999px;
          border: 1px solid transparent;
          opacity: 0;
          pointer-events: none;
        }

        /* THINKING — orb wakes up: halo brightens, core glows, two arcs
           counter-rotate around the core so the motion reads at any size. */
        .lm-orb[data-state="thinking"] .lm-orb__halo {
          opacity: 1;
          background: radial-gradient(
            circle,
            hsl(0 0% 100% / 0.42) 0%,
            hsl(0 0% 100% / 0.14) 45%,
            transparent 78%
          );
          animation: lm-breathe-fast 1.6s ease-in-out infinite;
          filter: blur(3px);
        }
        .lm-orb[data-state="thinking"] .lm-orb__core {
          width: 42%; height: 42%;
          background: radial-gradient(
            circle,
            hsl(0 0% 100%) 0%,
            hsl(0 0% 100% / 0.85) 50%,
            hsl(0 0% 100% / 0.2) 100%
          );
          box-shadow:
            0 0 22px hsl(0 0% 100% / 0.75),
            0 0 56px hsl(0 0% 100% / 0.32);
          animation: lm-breathe-fast 1.6s ease-in-out infinite;
        }
        .lm-orb[data-state="thinking"] .lm-orb__arc--a {
          opacity: 1;
          border-top-color: hsl(0 0% 100% / 0.85);
          border-right-color: hsl(0 0% 100% / 0.45);
          box-shadow: 0 0 8px hsl(0 0% 100% / 0.3);
          animation: lm-rotate-cw 1.8s linear infinite;
        }
        .lm-orb[data-state="thinking"] .lm-orb__arc--b {
          width: 60%; height: 60%;
          opacity: 1;
          border-bottom-color: hsl(0 0% 100% / 0.65);
          border-left-color: hsl(0 0% 100% / 0.25);
          animation: lm-rotate-ccw 2.4s linear infinite;
        }

        /* TOOL — single satellite detaches and drifts out */
        .lm-orb__tool {
          width: 16%;
          height: 16%;
          transform: translate(-50%, -50%) scale(0);
          background: radial-gradient(circle, hsl(0 0% 100%), hsl(0 0% 100% / 0.2));
          box-shadow: 0 0 12px hsl(0 0% 100% / 0.7);
          opacity: 0;
        }
        .lm-orb[data-state="tool"] .lm-orb__tool {
          animation: lm-tool-eject 1.6s ease-out infinite;
        }

        /* SPAWN — satellites orbit the core */
        .lm-orb__sat {
          width: 14%;
          height: 14%;
          background: radial-gradient(circle, hsl(0 0% 100%), hsl(0 0% 100% / 0.15));
          box-shadow: 0 0 10px hsl(0 0% 100% / 0.65);
          transform-origin: center;
          animation: lm-orbit 6s linear infinite;
        }

        /* ERROR — one sharp red pulse */
        .lm-orb[data-state="error"] .lm-orb__core {
          animation: lm-error-pulse 700ms ease-out 1;
        }
        .lm-orb[data-state="error"] .lm-orb__halo {
          animation: lm-breathe-slow 6s ease-in-out infinite;
        }

        /* SUSPENDED — orb goes still, dim, hairline ring */
        .lm-orb[data-state="suspended"] .lm-orb__core {
          animation: none;
          background: hsl(0 0% 100% / 0.18);
          box-shadow: none;
        }
        .lm-orb[data-state="suspended"] .lm-orb__halo {
          animation: none;
          opacity: 0.18;
        }
        .lm-orb__ring {
          width: 86%;
          height: 86%;
          transform: translate(-50%, -50%);
          border: 1px solid hsl(0 0% 100% / 0.2);
          opacity: 0;
        }
        .lm-orb[data-state="suspended"] .lm-orb__ring { opacity: 1; }

        /* === keyframes === */
        @keyframes lm-breathe-slow {
          0%, 100% { transform: translate(-50%, -50%) scale(1);    opacity: 0.55; }
          50%      { transform: translate(-50%, -50%) scale(1.03); opacity: 0.75; }
        }
        @keyframes lm-breathe-fast {
          0%, 100% { transform: translate(-50%, -50%) scale(1);    opacity: 0.85; }
          50%      { transform: translate(-50%, -50%) scale(1.08); opacity: 1;    }
        }
        @keyframes lm-rotate-cw  { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes lm-rotate-ccw { to { transform: translate(-50%, -50%) rotate(-360deg); } }
        @keyframes lm-tool-eject {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0;   }
          15%  { transform: translate(-50%, -50%) scale(1);   opacity: 1;   }
          85%  { transform: translate(120%,  -50%) scale(0.6); opacity: 0.4; }
          100% { transform: translate(220%,  -50%) scale(0);   opacity: 0;   }
        }
        @keyframes lm-orbit {
          from {
            transform:
              translate(-50%, -50%)
              rotate(var(--lm-orb-angle, 0deg))
              translateX(var(--lm-orb-radius, 24px))
              scale(var(--lm-orb-scale, 1));
          }
          to {
            transform:
              translate(-50%, -50%)
              rotate(calc(var(--lm-orb-angle, 0deg) + 360deg))
              translateX(var(--lm-orb-radius, 24px))
              scale(var(--lm-orb-scale, 1));
          }
        }
        @keyframes lm-error-pulse {
          0%   { box-shadow: 0 0 18px hsl(0 0% 100% / 0.55); background: radial-gradient(circle, hsl(0 0% 100%), hsl(0 0% 100% / 0.2)); }
          40%  { box-shadow: 0 0 40px hsl(0 100% 70% / 0.9);  background: radial-gradient(circle, hsl(0 100% 80%), hsl(0 100% 60% / 0.3)); }
          100% { box-shadow: 0 0 18px hsl(0 0% 100% / 0.55); background: radial-gradient(circle, hsl(0 0% 100%), hsl(0 0% 100% / 0.2)); }
        }
      `}</style>
    </div>
  );
}
