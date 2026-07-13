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
import { PILLAR_INFO } from "@/lib/pillars";

// Icons are presentation and stay client-side; label + color come from the
// single-source PILLAR_INFO taxonomy (also served at /api/ops/meta), so the
// contract isn't duplicated.
const PILLAR_ICONS: Record<string, LucideIcon> = {
  ideate: Lightbulb,
  research: Search,
  execute: Cog,
  coordinate: Network,
  communicate: MessageCircle,
  maintain: Wrench,
};

export type PillarMeta = { label: string; icon: LucideIcon; color: string };

export function pillarMeta(pillar: string | null | undefined): PillarMeta {
  const info = pillar ? PILLAR_INFO[pillar as keyof typeof PILLAR_INFO] : undefined;
  if (info) return { label: info.label, icon: PILLAR_ICONS[pillar as string] || Circle, color: info.color };
  return { label: "Unclassified", icon: Circle, color: "#94a3b8" };
}

// Convenience map for iterating all pillars (filters, legends).
export const PILLAR_META: Record<string, PillarMeta> = Object.fromEntries(
  Object.keys(PILLAR_INFO).map((k) => [k, pillarMeta(k)])
);
