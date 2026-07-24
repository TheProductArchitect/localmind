import { describe, it, expect, vi, beforeEach } from "vitest";
import { toGeminiContents, normalizeGeminiModelId } from "../src/lib/providers/gemini";

vi.mock("../src/lib/db/apikeys", () => ({
  getApiKey: vi.fn(() => "test-key"),
}));

describe("gemini provider helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes models/ prefix", () => {
    expect(normalizeGeminiModelId("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(normalizeGeminiModelId("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("maps system + user + assistant tool calls to Gemini contents", () => {
    const { systemInstruction, contents } = toGeminiContents([
      { role: "system", content: "You are Sora." },
      { role: "user", content: "search the web" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "1", name: "web_search", arguments: { q: "news" } }],
      },
      { role: "tool", content: "results…", tool_call_id: "1", name: "web_search" },
    ]);
    expect(systemInstruction?.parts[0].text).toContain("You are Sora.");
    expect(contents[0].role).toBe("user");
    expect(contents[1].role).toBe("model");
    expect((contents[1].parts[0] as any).functionCall.name).toBe("web_search");
    expect(contents[2].role).toBe("user");
    expect((contents[2].parts[0] as any).functionResponse.name).toBe("web_search");
  });
});
