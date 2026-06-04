"use client";

/**
 * /lab/orb — dev preview of the Orb component in all its states.
 *
 * This page is not in the nav and is for visual review during the v2 redesign.
 * Delete the /lab/ directory once the orb is wired into the real chat shell.
 */

import { useState } from "react";
import { Orb, type OrbState } from "@/components/orb";

const STATES: { id: OrbState; label: string; description: string }[] = [
  { id: "idle",      label: "Idle",      description: "soft breathing, ~30% luminance" },
  { id: "thinking",  label: "Thinking",  description: "halo rotates, core flares" },
  { id: "tool",      label: "Tool call", description: "satellite ejects and dissolves" },
  { id: "spawn",     label: "Spawn",     description: "subagents orbit the core" },
  { id: "error",     label: "Error",     description: "single sharp pulse" },
  { id: "suspended", label: "Suspended", description: "still, dim, hairline ring (loop guard)" },
];

export default function OrbLab() {
  const [hero, setHero] = useState<OrbState>("idle");
  const [satellites, setSatellites] = useState(3);

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-10 py-20">
      <header className="mb-16">
        <p className="lm-micro mb-3">LocalMind · Lab</p>
        <h1 className="lm-display lm-glow">The Orb</h1>
        <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(var(--foreground) / 0.6)" }}>
          One motion primitive, six states. Every living signal in the product
          flows through this component — nothing else animates on its own.
        </p>
      </header>

      <section className="lm-surface-1 rounded-none p-12 mb-16 flex flex-col items-center">
        <Orb state={hero} size={220} satellites={satellites} ariaLabel={`Orb state: ${hero}`} />

        <div className="mt-12 flex flex-wrap justify-center gap-2">
          {STATES.map((s) => (
            <button
              key={s.id}
              onClick={() => setHero(s.id)}
              className="px-4 py-2 text-[12px] tracking-tight transition-colors"
              style={{
                borderRadius: "var(--lm-radius-control)",
                border: "1px solid hsl(0 0% 100% / 0.10)",
                background: hero === s.id ? "hsl(0 0% 100% / 0.10)" : "transparent",
                color: hero === s.id ? "hsl(0 0% 100%)" : "hsl(0 0% 100% / 0.62)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {hero === "spawn" && (
          <div className="mt-6 flex items-center gap-3">
            <span className="lm-micro">Satellites</span>
            <input
              type="range"
              min={1}
              max={6}
              value={satellites}
              onChange={(e) => setSatellites(Number(e.target.value))}
              style={{ accentColor: "white" }}
            />
            <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.62)" }}>{satellites}</span>
          </div>
        )}
      </section>

      <div className="lm-hairline mb-16" />

      <section>
        <p className="lm-micro mb-6">All states · grid</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {STATES.map((s) => (
            <div
              key={s.id}
              className="lm-surface-1 flex flex-col items-center justify-center py-10"
              style={{ borderRadius: 0 }}
            >
              <Orb state={s.id} size={88} satellites={3} />
              <p className="mt-6 lm-body" style={{ color: "hsl(0 0% 100%)" }}>{s.label}</p>
              <p className="mt-1 lm-body text-center px-6" style={{ color: "hsl(0 0% 100% / 0.45)", fontSize: 12 }}>
                {s.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="lm-hairline my-16" />

      <section>
        <p className="lm-micro mb-6">Type ramp</p>
        <div className="space-y-6">
          <div>
            <p className="lm-display">A quiet machine</p>
            <p className="lm-micro mt-1">lm-display · 28/34 · -0.02em</p>
          </div>
          <div>
            <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.62)" }}>
              Sora has been thinking for 4 seconds. Three subagents are running
              in parallel; one is finishing up.
            </p>
            <p className="lm-micro mt-1">lm-body · 14/22 · -0.005em</p>
          </div>
          <div>
            <p className="lm-micro">Local · No cloud · Audited</p>
            <p className="lm-micro mt-1" style={{ opacity: 0.5 }}>lm-micro · 11/16 · 0.04em uppercase</p>
          </div>
        </div>
      </section>
    </main>
  );
}
