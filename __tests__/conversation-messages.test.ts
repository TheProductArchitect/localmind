import { describe, it, expect, vi } from "vitest";

let rows: any[] = [];
vi.mock("../src/lib/db/queries", () => ({ getMessages: () => rows }));

import { buildConversationMessages } from "../src/lib/agent/conversation-messages";

describe("buildConversationMessages — multimodal", () => {
  it("rehydrates image attachments onto user messages as base64 (no data prefix)", () => {
    rows = [
      {
        role: "user",
        content: "what is this?",
        attachments: JSON.stringify([{ mime: "image/png", data: "data:image/png;base64,AAAterm" }]),
      },
    ];
    const msgs = buildConversationMessages("c1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user", content: "what is this?", images: ["AAAterm"] });
  });

  it("leaves plain user messages without an images field", () => {
    rows = [{ role: "user", content: "hi", attachments: null }];
    const msgs = buildConversationMessages("c1");
    expect((msgs[0] as any).images).toBeUndefined();
  });

  it("rehydrates tool messages and skips unparseable ones", () => {
    rows = [
      { role: "assistant", content: "ok" },
      { role: "tool", content: JSON.stringify({ output: "42", id: "t1", name: "calc" }) },
      { role: "tool", content: "not json" },
    ];
    const msgs = buildConversationMessages("c1");
    expect(msgs.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(msgs[1]).toMatchObject({ role: "tool", content: "42", tool_call_id: "t1", name: "calc" });
  });
});
