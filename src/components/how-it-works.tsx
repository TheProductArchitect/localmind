"use client";

/**
 * <HowItWorks/> — a reusable collapsed explainer tile.
 *
 * Matches the pattern first used by the /fleet "How they connect" tile and
 * the /orchestration explainer: a single-line header that toggles to reveal
 * a bullet list (or arbitrary children) below. Collapsed by default so
 * pages stay quiet at rest, and a single keypress / click reveals the
 * deeper context for the user who needs it.
 *
 *   <HowItWorks title="How agents spawn">
 *     <ul>
 *       <li><b>Sora summons.</b> When the task needs a specialist...</li>
 *     </ul>
 *   </HowItWorks>
 *
 * Or with structured bullets:
 *
 *   <HowItWorks
 *     title="How memory works"
 *     bullets={[
 *       { title: "On-demand", body: "Sora reads memory via the memory tool..." },
 *       { title: "Always allowed", body: "Reading memory is part of cognition..." },
 *     ]}
 *   />
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type HowItWorksBullet = { title: string; body: React.ReactNode };

export function HowItWorks({
  title,
  bullets,
  children,
  defaultOpen = false,
}: {
  title: string;
  bullets?: HowItWorksBullet[];
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="lm-transport" data-open={open}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="lm-transport__head"
        aria-expanded={open}
        data-pulse="true"
      >
        <span className="lm-micro">{title}</span>
        <ChevronDown
          className="h-3.5 w-3.5 ml-auto"
          style={{
            color: "hsl(0 0% 100% / 0.4)",
            transition: "transform var(--lm-dur-micro) var(--lm-ease-micro)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>
      {open && (
        <div style={{ padding: "4px 18px 16px", borderTop: "1px solid hsl(0 0% 100% / 0.05)" }}>
          {bullets && (
            <ul className="lm-transport__list" style={{ paddingTop: 4 }}>
              {bullets.map((b, i) => (
                <li key={i}>
                  <b>{b.title}</b> {b.body}
                </li>
              ))}
            </ul>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
