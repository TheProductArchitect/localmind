"use client";

/**
 * <PageHeader/> — the v2 page-opener.
 *
 * Every redesigned page starts with the same vertical rhythm: a micro
 * eyebrow tag, a 28px display heading, and an optional sub-line. Using
 * this primitive instead of bespoke h1+text pairings keeps the type ramp
 * uniform across surfaces and makes future global tweaks one-line edits.
 */

import * as React from "react";

export function PageHeader({
  eyebrow,
  title,
  hint,
  actions,
}: {
  eyebrow: string;
  title: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-10 flex items-end justify-between gap-6">
      <div>
        <p className="lm-micro mb-2">{eyebrow}</p>
        <h1 className="lm-display">{title}</h1>
        {hint && (
          <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
            {hint}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * <PageShell/> — the consistent outer wrapper. Use it as the top-level
 * element on any redesigned page so the column width, padding, and
 * overflow behavior stay consistent across surfaces.
 */
export function PageShell({
  children,
  width = "narrow",
}: {
  children: React.ReactNode;
  width?: "narrow" | "wide" | "full";
}) {
  const max = width === "narrow" ? "max-w-4xl" : width === "wide" ? "max-w-6xl" : "max-w-none";
  return <div className={`mx-auto ${max} px-10 py-14`}>{children}</div>;
}
