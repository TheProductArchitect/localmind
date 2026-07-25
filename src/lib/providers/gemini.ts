import { nanoid } from "nanoid";
import { getApiKey } from "../db/apikeys";
import type { ChatMessage, Provider, ProviderDelta, ToolDefinition } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_MODELS = [
  { name: "gemini-2.5-flash" },
  { name: "gemini-2.5-pro" },
  { name: "gemini-2.0-flash" },
  { name: "gemini-flash-latest" },
];

/** Strip `models/` prefix if present (list API returns `models/gemini-…`). */
export function normalizeGeminiModelId(id: string): string {
  return id.replace(/^models\//, "");
}

export function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: string; parts: Record<string, unknown>[] }[];
} {
  let system = "";
  const contents: { role: string; parts: Record<string, unknown>[] }[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system += (m.content || "") + "\n";
      continue;
    }
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name,
              response: { result: m.content },
            },
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls || []) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments || {},
          },
        });
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    // user
    const parts: Record<string, unknown>[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const img of m.images || []) {
      const data = img.startsWith("data:") ? img.replace(/^data:[^;]+;base64,/, "") : img;
      parts.push({
        inlineData: { mimeType: "image/jpeg", data },
      });
    }
    contents.push({ role: "user", parts: parts.length ? parts : [{ text: "" }] });
  }

  return {
    systemInstruction: system.trim() ? { parts: [{ text: system.trim() }] } : undefined,
    contents,
  };
}

function toolsToGemini(tools: ToolDefinition[]) {
  if (!tools.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export const geminiProvider: Provider = {
  name: "gemini",

  async testConnection() {
    const key = getApiKey("gemini");
    if (!key) return { ok: false, error: "No API key saved" };
    try {
      const r = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=1`);
      if (r.ok) return { ok: true };
      const body = await r.text().catch(() => "");
      return { ok: false, error: `HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Connection failed" };
    }
  },

  async getModels() {
    const key = getApiKey("gemini");
    if (!key) return DEFAULT_MODELS;
    try {
      const r = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=100`);
      if (!r.ok) return DEFAULT_MODELS;
      const j = (await r.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };
      const listed = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => ({ name: normalizeGeminiModelId(m.name || "") }))
        .filter((m) => m.name && m.name.startsWith("gemini"));
      return listed.length ? listed : DEFAULT_MODELS;
    } catch {
      return DEFAULT_MODELS;
    }
  },

  async *chat({ model, messages, tools, signal }): AsyncGenerator<ProviderDelta> {
    const key = getApiKey("gemini");
    if (!key) throw new Error("No API key configured for gemini");
    const modelId = normalizeGeminiModelId(model);
    const { systemInstruction, contents } = toGeminiContents(messages);

    const url = `${BASE}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction,
        tools: toolsToGemini(tools),
        generationConfig: { maxOutputTokens: 8192 },
      }),
      signal,
    });
    if (!r.ok || !r.body) {
      const errText = await r.text().catch(() => "");
      throw new Error(`gemini chat failed: ${r.status}${errText ? ` ${errText.slice(0, 300)}` : ""}`);
    }

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
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let obj: any;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        const parts = obj?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (typeof part.text === "string" && part.text) {
            yield { type: "text", delta: part.text };
          }
          if (part.functionCall?.name) {
            yield {
              type: "tool_call",
              call: {
                id: nanoid(10),
                name: part.functionCall.name,
                arguments: (part.functionCall.args || {}) as Record<string, unknown>,
              },
            };
          }
        }
      }
    }
    yield { type: "done" };
  },
};
