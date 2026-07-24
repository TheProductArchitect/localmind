import { evaluateRules, type RoutingContext } from "../db/routing-rules";
import { listPersonas } from "../db/personas";

export type RoutedModel = {
  /** Chat provider name, or null to inherit settings.provider. */
  provider: string | null;
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
  const hasUrl = /https?:\/\//i.test(message);
  if (hasUrl) {
    tools.push("read_secure_webpage", "web_research");
  } else if (/\b(search|google|web|internet|latest|news)\b/.test(lower)) {
    tools.push("web_search", "web_research");
  }
  if (/\b(calendar|meeting|schedule|appointment)\b/.test(lower)) tools.push("calendar");
  if (/\b(email|mail|inbox)\b/.test(lower)) tools.push("email");
  // Only hint filesystem for local paths / file ops — never when the "read"
  // is aimed at a web URL (that previously pushed models at filesystem).
  if (!hasUrl && /\b(file|folder|directory|read|write)\b/.test(lower)) tools.push("filesystem");
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

/** True when `target` looks like a model id rather than an agent/persona name. */
function looksLikeModelId(target: string): boolean {
  // provider/model, family:tag, or dotted model families commonly used by Ollama/OpenAI.
  return /[/:]/.test(target) || /\b(gpt|claude|llama|mistral|qwen|phi|gemma|deepseek|gemini)\b/i.test(target);
}

/**
 * Resolve which provider+model to use for a user message based on routing rules.
 * Falls back to the settings default when no rule matches, or when a rule
 * targets an unknown agent with no model configured. Never invents an
 * Ollama model name from an agent label like "Research" — that previously
 * produced "model not found" and looked like a dropped chat connection.
 */
export function resolveRoutedModel(
  userMessage: string,
  defaultModel: string | null,
  activePersona?: string | null,
  defaultProvider?: string | null
): RoutedModel {
  const inheritProvider = defaultProvider ?? null;
  const match = evaluateRules(buildRoutingContext(userMessage, activePersona));
  if (!match) {
    return { provider: inheritProvider, model: defaultModel, matchedAgent: null, ruleId: null };
  }

  const target = match.target_agent_name.trim();
  if (!target || target.toLowerCase() === "main") {
    return {
      provider: inheritProvider,
      model: defaultModel,
      matchedAgent: "Main",
      ruleId: match.rule_id,
    };
  }

  const personas = listPersonas();
  const lower = target.toLowerCase();
  const persona = personas.find(
    (p) =>
      p.name.toLowerCase() === lower ||
      p.persona_id === target ||
      p.persona_id === `persona-${lower}` ||
      p.persona_id === `agent-${lower}` ||
      // "Research" → "Researcher", "Code" → "Coder", etc.
      p.name.toLowerCase().startsWith(lower) ||
      lower.startsWith(p.name.toLowerCase())
  );
  if (persona) {
    return {
      provider: persona.provider || inheritProvider,
      model: persona.model_name || defaultModel,
      matchedAgent: persona.name,
      ruleId: match.rule_id,
    };
  }

  if (looksLikeModelId(target)) {
    // Optional "provider/model" form for explicit cloud ids
    const slash = target.indexOf("/");
    if (slash > 0) {
      const maybeProvider = target.slice(0, slash).toLowerCase();
      const known = ["ollama", "openai", "anthropic", "groq", "openrouter", "lmstudio", "gemini"];
      if (known.includes(maybeProvider)) {
        return {
          provider: maybeProvider,
          model: target.slice(slash + 1),
          matchedAgent: target,
          ruleId: match.rule_id,
        };
      }
    }
    return {
      provider: inheritProvider,
      model: target,
      matchedAgent: target,
      ruleId: match.rule_id,
    };
  }

  // Unknown agent label with no persona — keep the default model rather than
  // asking the provider for a nonexistent model named after the agent.
  return {
    provider: inheritProvider,
    model: defaultModel,
    matchedAgent: target,
    ruleId: match.rule_id,
  };
}
