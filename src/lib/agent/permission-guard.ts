import { getActiveProfile } from "../db/queries";

export type Tier = "allow" | "ask" | "pin";

export function classify(actionType: string): Tier {
  const profile = getActiveProfile();
  const tier = profile.tiers[actionType];
  if (tier === "allow" || tier === "ask" || tier === "pin") return tier;
  // Default to ask if unknown
  return "ask";
}
