import { nanoid } from "nanoid";
import type { ChatMessage, Provider, ProviderDelta, ToolDefinition } from "./types";

const HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export const ollamaProvider: Provider = {
  name: "ollama",

  async testConnection() {
    try {
      const r = await fetch(`${HOST}/api/tags`);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Cannot reach Ollama" };
    }
  },

  async getModels() {
    const r = await fetch(`${HOST}/api/tags`);
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: any[] };
    return (j.models || []).map((m) => ({
      name: m.name,
      family: m.details?.family,
      size: m.size,
      modified: m.modified_at,
    }));
  },

  async *chat({ model, messages, tools, signal, contextWindow }): AsyncGenerator<ProviderDelta> {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool", content: m.content };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant",
            content: m.content || "",
            tool_calls: m.tool_calls.map((tc) => ({
              function: { name: tc.name, arguments: tc.arguments },
            })),
          };
        }
        // Multimodal: Ollama vision models take an `images: [base64]` field.
        if (m.role === "user" && (m as any).images?.length) {
          return { role: "user", content: m.content, images: (m as any).images };
        }
        return { role: m.role, content: (m as any).content };
      }),
      stream: true,
      tools: tools.length
        ? tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    };

    // Tell Ollama what context window to load the model with; without this it
    // silently uses its small default (often 2k–4k), starving large models.
    if (contextWindow && contextWindow > 0) {
      body.options = { num_ctx: contextWindow };
    }
    // Top-level keep_alive avoids multi-second cold reloads between turns.
    body.keep_alive = "30m";

    const r = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`Ollama chat failed: ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        const msg = obj.message;
        if (msg?.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            yield {
              type: "tool_call",
              call: {
                id: tc.id || nanoid(10),
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || {},
              },
            };
          }
        }
        if (msg?.content) yield { type: "text", delta: msg.content };
        if (obj.done) yield { type: "done" };
      }
    }
  },
};

export async function pullModel(name: string, onProgress: (pct: number, status: string) => void, signal?: AbortSignal) {
  const r = await fetch(`${HOST}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`Pull failed: ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        const total = o.total || 0;
        const completed = o.completed || 0;
        const pct = total > 0 ? Math.floor((completed / total) * 100) : 0;
        onProgress(pct, o.status || "");
      } catch {}
    }
  }
}

export async function deleteOllamaModel(name: string) {
  const r = await fetch(`${HOST}/api/delete`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
}
