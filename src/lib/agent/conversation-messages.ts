import type { ChatMessage } from "../providers/types";
import { getMessages } from "../db/queries";

/**
 * Build the non-system message list for a conversation exactly as the agent
 * engine feeds it to the model: user/assistant turns verbatim, and tool
 * messages rehydrated from their stored JSON. Shared by the engine and the
 * idle summary precompute so the rolling summary's `covered_count` watermark
 * stays consistent between them.
 */
function imagesFromAttachments(attachments: string | null | undefined): string[] {
  if (!attachments) return [];
  try {
    const arr = JSON.parse(attachments) as { data?: string }[];
    return arr
      .map((a) => (a?.data || "").replace(/^data:[^;]+;base64,/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function buildConversationMessages(conversationId: string): ChatMessage[] {
  const history = getMessages(conversationId);
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const images = imagesFromAttachments(m.attachments);
      out.push(images.length ? { role: "user", content: m.content, images } : { role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
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
