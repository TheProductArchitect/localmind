import {
  Lightbulb,
  Search,
  Cog,
  Network,
  MessageCircle,
  Wrench,
  Circle,
  type LucideIcon,
} from "lucide-react";

// Pillar → icon + color, shared by the Ops board and orchestration views (§6.4).
// Colors are Tailwind text classes so they read on the dark UI.
export const PILLAR_META: Record<
  string,
  { label: string; icon: LucideIcon; color: string }
> = {
  ideate: { label: "Ideate", icon: Lightbulb, color: "text-amber-400" },
  research: { label: "Research", icon: Search, color: "text-sky-400" },
  execute: { label: "Execute", icon: Cog, color: "text-emerald-400" },
  coordinate: { label: "Coordinate", icon: Network, color: "text-violet-400" },
  communicate: { label: "Communicate", icon: MessageCircle, color: "text-rose-400" },
  maintain: { label: "Maintain", icon: Wrench, color: "text-slate-400" },
};

export function pillarMeta(pillar: string | null | undefined) {
  return (pillar && PILLAR_META[pillar]) || { label: "Unclassified", icon: Circle, color: "text-muted-foreground" };
}
