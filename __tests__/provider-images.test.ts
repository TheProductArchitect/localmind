import { describe, it, expect } from "vitest";
import { toOpenAIMessages } from "../src/lib/providers/openai-compatible";
import { toAnthropic } from "../src/lib/providers/anthropic";
import type { ChatMessage } from "../src/lib/providers/types";

describe("cloud multimodal image shaping (HIGH)", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "what is this?", images: ["abc123"] },
  ];

  it("OpenAI-compatible wraps images as image_url parts", () => {
    const out = toOpenAIMessages(messages) as any[];
    expect(out[0].content[0]).toEqual({ type: "text", text: "what is this?" });
    expect(out[0].content[1].type).toBe("image_url");
    expect(out[0].content[1].image_url.url).toBe("data:image/jpeg;base64,abc123");
  });

  it("Anthropic wraps images as base64 image blocks", () => {
    const { messages: out } = toAnthropic(messages);
    expect(out[0].content[1].type).toBe("image");
    expect(out[0].content[1].source.data).toBe("abc123");
  });

  it("plain text user messages stay strings", () => {
    const plain: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect((toOpenAIMessages(plain) as any[])[0].content).toBe("hi");
    expect(toAnthropic(plain).messages[0].content).toBe("hi");
  });
});
