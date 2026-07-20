import type { Pillar } from "../db/agent-processes";

// Persona → pillar for spawned specialists whose role is unambiguous.
const PERSONA_PILLAR: Record<string, Pillar> = {
  "persona-strategist": "ideate",
  "agent-researcher": "research",
  "agent-coder": "execute",
  "agent-reviewer": "execute",
  "agent-comms": "communicate",
  "agent-scheduler": "coordinate",
};

// Ordered keyword heuristics. First match wins; order encodes priority so that,
// e.g., "brainstorm how to email everyone" reads as ideate, not communicate.
const RULES: { pillar: Pillar; re: RegExp }[] = [
  { pillar: "ideate", re: /\b(brainstorm|ideate|ideas?|strategy|strategi[sz]e|options?|pros and cons|trade-?offs?|what should i|help me (?:think|decide|plan)|plan (?:for|out))\b/i },
  { pillar: "coordinate", re: /\b(orchestrat|delegate|in parallel|multiple agents?|spawn|coordinate|break (?:this )?down into)\b/i },
  { pillar: "communicate", re: /\b(send|email|e-mail|message|text|whatsapp|telegram|\bdm\b|reply|respond to|call|post|notify)\b/i },
  { pillar: "execute", re: /\b(code|build|implement|fix|refactor|deploy|run|write (?:a |the )?(?:file|script|function|test)|create (?:a |the )?(?:file|script|app|project)|edit|generate)\b/i },
  { pillar: "research", re: /\b(research|find out|look up|search|investigate|who is|what is|when did|latest|news|compare|summari[sz]e|read)\b/i },
];

/** Best-effort pillar tag for a unit of work, from the persona and the request
 *  text. Returns null when genuinely unclassifiable (§6.5). Pure + testable. */
export function classifyPillar(text: string, personaId?: string | null): Pillar | null {
  if (personaId && PERSONA_PILLAR[personaId]) return PERSONA_PILLAR[personaId];
  const t = (text || "").trim();
  if (!t) return null;
  for (const { pillar, re } of RULES) {
    if (re.test(t)) return pillar;
  }
  return null;
}
