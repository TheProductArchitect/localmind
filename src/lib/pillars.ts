// Pillar taxonomy (§6) — a pure, dependency-free module so it's safe to import
// from both client components and server/DB code. The single source of truth
// for the pillar contract; served at /api/ops/meta for runtime discovery.

// The five capability pillars plus `maintain` for idle/self-upkeep work.
export const PILLARS = ["ideate", "research", "execute", "coordinate", "communicate", "maintain"] as const;
export type Pillar = (typeof PILLARS)[number];

// Framework-agnostic (hex color, plain text) so any client — the UI, a tool, or
// an agent — can query and render it without duplicating the contract.
export const PILLAR_INFO: Record<Pillar, { label: string; description: string; color: string }> = {
  ideate: { label: "Ideate", description: "Brainstorm options and converge to a plan", color: "#fbbf24" },
  research: { label: "Research", description: "Search, read, and synthesize information", color: "#38bdf8" },
  execute: { label: "Execute", description: "Build, edit, run, and produce artifacts", color: "#34d399" },
  coordinate: { label: "Coordinate", description: "Orchestrate subagents and multi-step work", color: "#a78bfa" },
  communicate: { label: "Communicate", description: "Send and manage outbound messages", color: "#fb7185" },
  maintain: { label: "Maintain", description: "Idle upkeep, tests, and self-improvement", color: "#94a3b8" },
};
