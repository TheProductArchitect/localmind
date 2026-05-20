import { nanoid } from "nanoid";
import { getApiKey } from "../db/apikeys";
import type { ChatMessage, Provider, ProviderDelta, ToolDefinition } from "./types";

const BASE = "https://api.anthropic.com/v1";

function toAnthropic(messages: ChatMessage[]) {
  let system = "";
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system += (m as any).content + "\n";
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: m.role, content: (m as any).content });
  }
  return { system: system.trim(), messages: out };
}

export const anthropicProvider: Provider = {
  name: "anthropic",

  async testConnection() {
    const key = getApiKey("anthropic");
    if (!key) return { ok: false, error: "No API key saved" };
    try {
      const r = await fetch(`${BASE}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      return r.ok || r.status === 400 ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Connection failed" };
    }
  },

  async getModels() {
    return [
      { name: "claude-sonnet-4-6" },
      { name: "claude-opus-4-7" },
      { name: "claude-3-5-haiku-latest" },
    ];
  },

  async *chat({ model, messages, tools, signal }): AsyncGenerator<ProviderDelta> {
    const key = getApiKey("anthropic");
    if (!key) throw new Error("No API key configured for anthropic");
    const { system, messages: msgs } = toAnthropic(messages);

    const r = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: system || undefined,
        messages: msgs,
        stream: true,
        tools: tools.length
          ? tools.map((t: ToolDefinition) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            }))
          : undefined,
      }),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`anthropic chat failed: ${r.status}`);

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let curTool: { id: string; name: string; args: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        let obj: any;
        try { obj = JSON.parse(t.slice(5).trim()); } catch { continue; }

        if (obj.type === "content_block_start" && obj.content_block?.type === "tool_use") {
          curTool = { id: obj.content_block.id, name: obj.content_block.name, args: "" };
        } else if (obj.type === "content_block_delta") {
          if (obj.delta?.type === "text_delta") yield { type: "text", delta: obj.delta.text };
          if (obj.delta?.type === "input_json_delta" && curTool) curTool.args += obj.delta.partial_json;
        } else if (obj.type === "content_block_stop" && curTool) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(curTool.args || "{}"); } catch {}
          yield { type: "tool_call", call: { id: curTool.id || nanoid(10), name: curTool.name, arguments: args } };
          curTool = null;
        } else if (obj.type === "message_stop") {
          yield { type: "done" };
        }
      }
    }
  },
};
