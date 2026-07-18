import type { ChatMessage } from "../providers/types";
import { getMessages } from "../db/queries";

/**
 * Build the non-system message list for a conversation exactly as the agent
 * engine feeds it to the model: user/assistant turns verbatim, and tool
 * messages rehydrated from their stored JSON. Shared by the engine and the
 * idle summary precompute so the rolling summary's `covered_count` watermark
 * stays consistent between them.
 */
export function buildConversationMessages(conversationId: string): ChatMessage[] {
  const history = getMessages(conversationId);
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    } else if (m.role === "tool") {
      try {
        const parsed = JSON.parse(m.content);
        out.push({ role: "tool", content: parsed.output, tool_call_id: parsed.id, name: parsed.name });
      } catch {
        /* skip unparseable tool rows — same as the engine */
      }
    }
  }
  return out;
}
