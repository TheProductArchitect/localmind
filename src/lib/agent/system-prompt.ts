import { assembleSystemPromptSync } from "./assemble-system-prompt";

/**
 * Backward-compatible entry point for the agent engine. V5 delegates to the
 * persona-aware block assembler. Callers that don't yet know a persona id get
 * the General Assistant persona, whose built-in blocks render the same logical
 * content as the legacy hand-written prompt.
 */
export function buildSystemPrompt(userId?: string, personaId: string = "persona-general"): string {
  return assembleSystemPromptSync(personaId, { userId });
}
