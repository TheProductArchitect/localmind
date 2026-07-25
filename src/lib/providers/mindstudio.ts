import { nanoid } from "nanoid";
import { getApiKey } from "../db/apikeys";
import type { ChatMessage, Provider, ProviderDelta, ToolDefinition } from "./types";
import { toOpenAIMessages } from "./openai-compatible";

/**
 * MindStudio — opt-in cloud model router.
 *
 * MindStudio's public surface is primarily workflow/agent run APIs, not a
 * documented OpenAI Chat Completions drop-in. We still speak OpenAI-compatible
 * HTTP so a gateway or future compatible base URL can be plugged in via
 * MINDSTUDIO_BASE_URL. Default is a placeholder; clear errors when the key
 * is missing or the base URL is unreachable.
 */
const DEFAULT_BASE = "https://api.mindstudio.ai/v1";

const DEFAULT_MODELS = [
  { name: "mindstudio/default" },
  { name: "mindstudio/fast" },
];

function baseUrl(): string {
  const raw = (process.env.MINDSTUDIO_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  return raw;
}

export const mindstudioProvider: Provider = {
  name: "mindstudio",

  async testConnection() {
    const apiKey = getApiKey("mindstudio");
    if (!apiKey) return { ok: false, error: "No API key saved for mindstudio (cloud — opt-in)" };
    try {
      const r = await fetch(`${baseUrl()}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) return { ok: true };
      const body = await r.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ""} (base ${baseUrl()}; set MINDSTUDIO_BASE_URL if your gateway differs)`,
      };
    } catch (e: any) {
      return {
        ok: false,
        error: `${e?.message || "Connection failed"} (base ${baseUrl()})`,
      };
    }
  },

  async getModels() {
    const apiKey = getApiKey("mindstudio");
    if (!apiKey) return DEFAULT_MODELS;
    try {
      const r = await fetch(`${baseUrl()}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) return DEFAULT_MODELS;
      const j = (await r.json()) as { data?: { id?: string }[] };
      const listed = (j.data || [])
        .map((m) => ({ name: m.id || "" }))
        .filter((m) => m.name);
      return listed.length ? listed : DEFAULT_MODELS;
    } catch {
      return DEFAULT_MODELS;
    }
  },

  async *chat({ model, messages, tools, signal }): AsyncGenerator<ProviderDelta> {
    const apiKey = getApiKey("mindstudio");
    if (!apiKey) {
      throw new Error(
        "No API key configured for mindstudio. Add one in Settings → Providers (cloud — opt-in)."
      );
    }

    const r = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(messages as ChatMessage[]),
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
    if (!r.ok || !r.body) {
      const errText = await r.text().catch(() => "");
      throw new Error(
        `mindstudio chat failed: ${r.status}${errText ? ` ${errText.slice(0, 300)}` : ""} (base ${baseUrl()})`
      );
    }

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
            try {
              args = JSON.parse(acc.args || "{}");
            } catch {}
            yield { type: "tool_call", call: { id: acc.id || nanoid(10), name: acc.name, arguments: args } };
          }
          yield { type: "done" };
          continue;
        }
        let obj: any;
        try {
          obj = JSON.parse(data);
        } catch {
          continue;
        }
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
