import { evaluateRules, type RoutingContext } from "../db/routing-rules";
import { listPersonas } from "../db/personas";

export type RoutedModel = {
  model: string | null;
  matchedAgent: string | null;
  ruleId: string | null;
};

/** Extract @AgentName manual override from the start of a message. */
export function parseManualOverride(message: string): string | null {
  const m = message.match(/^@([A-Za-z0-9_-]+)\b/);
  return m ? m[1] : null;
}

/** Heuristic task-type guess for routing rule evaluation. */
export function inferTaskType(message: string): string | undefined {
  const lower = message.toLowerCase();
  if (/\b(code|implement|refactor|fix bug|typescript|python|javascript|debug)\b/.test(lower)) return "code";
  if (/\b(search|research|find out|look up|latest|news|web)\b/.test(lower)) return "research";
  if (/\b(write|draft|essay|blog|compose)\b/.test(lower)) return "writing";
  if (/\b(analyze|analysis|compare|evaluate|summarize)\b/.test(lower)) return "analysis";
  if (message.length < 80) return "quick_lookup";
  return undefined;
}

/** Heuristic tool hints for routing rule evaluation. */
export function inferRequiredTools(message: string): string[] {
  const tools: string[] = [];
  const lower = message.toLowerCase();
  if (/\b(search|google|web|internet|latest|news)\b/.test(lower)) tools.push("web_search");
  if (/\b(calendar|meeting|schedule|appointment)\b/.test(lower)) tools.push("calendar");
  if (/\b(email|mail|inbox)\b/.test(lower)) tools.push("email");
  if (/\b(file|folder|directory|read|write)\b/.test(lower)) tools.push("filesystem");
  if (/\b(reminder|todo|task list)\b/.test(lower)) tools.push("reminders");
  return tools;
}

export function buildRoutingContext(
  userMessage: string,
  activePersona?: string | null
): RoutingContext {
  return {
    task_type: inferTaskType(userMessage),
    message_length: userMessage.length,
    required_tools: inferRequiredTools(userMessage),
    active_persona: activePersona ?? undefined,
    manual_override_agent: parseManualOverride(userMessage) ?? undefined,
  };
}

/**
 * Resolve which model to use for a user message based on routing rules.
 * Falls back to the settings default when no rule matches.
 */
export function resolveRoutedModel(
  userMessage: string,
  defaultModel: string | null,
  activePersona?: string | null
): RoutedModel {
  const match = evaluateRules(buildRoutingContext(userMessage, activePersona));
  if (!match) return { model: defaultModel, matchedAgent: null, ruleId: null };

  const target = match.target_agent_name.trim();
  if (!target || target.toLowerCase() === "main") {
    return { model: defaultModel, matchedAgent: "Main", ruleId: match.rule_id };
  }

  const personas = listPersonas();
  const persona = personas.find(
    (p) =>
      p.name.toLowerCase() === target.toLowerCase() ||
      p.persona_id === target ||
      p.persona_id === `persona-${target.toLowerCase()}`
  );
  if (persona?.model_name) {
    return { model: persona.model_name, matchedAgent: target, ruleId: match.rule_id };
  }

  // Treat target as a literal model name (e.g. "llama3.2", "gpt-4o-mini").
  return { model: target, matchedAgent: target, ruleId: match.rule_id };
}
