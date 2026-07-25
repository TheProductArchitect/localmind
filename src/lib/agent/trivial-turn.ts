/**
 * Turns that should never pay for tools / RAG — greetings and ack-only.
 * Keeps first-token latency low when the model would otherwise invent a tool call.
 */
export function isTrivialUserTurn(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t || t.length > 96) return false;
  // Reject anything that looks like a real ask.
  if (/[?/]|https?:|www\.|\b(what|why|how|when|where|who|can you|could you|please|help|find|search|code|file|email|calendar)\b/.test(t)) {
    return false;
  }
  return /^(hi|hello|hey|yo|sup|howdy|hiya|good\s*(morning|afternoon|evening|night)|thanks|thank\s*you|thx|ty|ok|okay|cool|nice|great|awesome|cheers|bye|goodbye|see\s*ya)[\s!,.]*$/i.test(
    t
  );
}
