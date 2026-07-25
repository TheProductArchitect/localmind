/**
 * Persist last chat chrome prefs so buttons/labels paint before /api/settings.
 */

export type ChatBootCache = {
  model: string | null;
  provider: string;
  agentMode: "auto" | "plan" | "ask";
  modelVision: boolean;
  toolHome: "initiator" | "executor";
};

const KEY = "lm.chat.boot.v1";

export function readChatBoot(): ChatBootCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as ChatBootCache;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export function writeChatBoot(partial: Partial<ChatBootCache>) {
  if (typeof window === "undefined") return;
  try {
    const cur = readChatBoot() || {
      model: null,
      provider: "ollama",
      agentMode: "auto" as const,
      modelVision: false,
      toolHome: "initiator" as const,
    };
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...partial }));
  } catch {
    /* ignore */
  }
}
