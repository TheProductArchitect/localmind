export type ChatMessage =
  | { role: "system"; content: string }
  // `images` are base64 strings (no data: prefix) for multimodal/vision models.
  | { role: "user"; content: string; images?: string[] }
  | { role: "assistant"; content: string; tool_calls?: ToolCallReq[] }
  | { role: "tool"; content: string; tool_call_id: string; name: string };

export type ToolCallReq = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};

export type ProviderDelta =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCallReq }
  | { type: "done" };

export interface Provider {
  name: string;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  getModels(): Promise<{ name: string; family?: string; size?: number; modified?: string }[]>;
  chat(opts: {
    model: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
    contextWindow?: number;
  }): AsyncGenerator<ProviderDelta>;
}
