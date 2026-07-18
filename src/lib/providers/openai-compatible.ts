import { nanoid } from "nanoid";
import { getApiKey } from "../db/apikeys";
import type { ChatMessage, Provider, ProviderDelta, ToolDefinition } from "./types";

type Config = {
  name: string;
  baseUrl: string;
  defaultModels: { name: string }[];
  /** When true, chat works without a saved API key (local servers). */
  apiKeyOptional?: boolean;
};

const CONFIGS: Record<string, Config> = {
  openai: {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModels: [{ name: "gpt-4o" }, { name: "gpt-4o-mini" }],
  },
  groq: {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModels: [{ name: "llama-3.3-70b-versatile" }, { name: "llama-3.1-8b-instant" }],
  },
  openrouter: {
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModels: [{ name: "anthropic/claude-3.5-sonnet" }, { name: "openai/gpt-4o-mini" }],
  },
  lmstudio: {
    name: "lmstudio",
    baseUrl: `${(process.env.LMSTUDIO_HOST || "http://localhost:1234").replace(/\/$/, "")}/v1`,
    defaultModels: [],
    apiKeyOptional: true,
  },
};

export function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    if (m.role === "user" && m.images?.length) {
      return {
        role: "user",
        content: [
          { type: "text", text: m.content || "" },
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
          })),
        ],
      };
    }
    return { role: m.role, content: (m as any).content };
  });
}

export function makeOpenAICompatibleProvider(key: keyof typeof CONFIGS): Provider {
  const cfg = CONFIGS[key];
  return {
    name: cfg.name,

    async testConnection() {
      const apiKey = getApiKey(cfg.name);
      if (!apiKey && !cfg.apiKeyOptional) return { ok: false, error: "No API key saved" };
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const r = await fetch(`${cfg.baseUrl}/models`, { headers });
        return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Connection failed" };
      }
    },

    async getModels() {
      const apiKey = getApiKey(cfg.name);
      if (!apiKey && !cfg.apiKeyOptional) return cfg.defaultModels;
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const r = await fetch(`${cfg.baseUrl}/models`, { headers });
        if (!r.ok) return cfg.defaultModels;
        const j = (await r.json()) as any;
        return (j.data || []).map((m: any) => ({ name: m.id }));
      } catch {
        return cfg.defaultModels;
      }
    },

    async *chat({ model, messages, tools, signal }): AsyncGenerator<ProviderDelta> {
      const apiKey = getApiKey(cfg.name);
      if (!apiKey && !cfg.apiKeyOptional) throw new Error(`No API key configured for ${cfg.name}`);

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      else if (cfg.apiKeyOptional) headers.Authorization = "Bearer lm-studio";

      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: toOpenAIMessages(messages),
          stream: true,
          tools: tools.length
            ? tools.map((t: ToolDefinition) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              }))
            : undefined,
        }),
        signal,
      });
      if (!r.ok || !r.body) throw new Error(`${cfg.name} chat failed: ${r.status}`);

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const toolAcc: Record<number, { id: string; name: string; args: string }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (data === "[DONE]") {
            for (const acc of Object.values(toolAcc)) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(acc.args || "{}"); } catch {}
              yield { type: "tool_call", call: { id: acc.id || nanoid(10), name: acc.name, arguments: args } };
            }
            yield { type: "done" };
            continue;
          }
          let obj: any;
          try { obj = JSON.parse(data); } catch { continue; }
          const delta = obj.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield { type: "text", delta: delta.content };
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolAcc[idx]) toolAcc[idx] = { id: "", name: "", args: "" };
              if (tc.id) toolAcc[idx].id = tc.id;
              if (tc.function?.name) toolAcc[idx].name += tc.function.name;
              if (tc.function?.arguments) toolAcc[idx].args += tc.function.arguments;
            }
          }
        }
      }
    },
  };
}
