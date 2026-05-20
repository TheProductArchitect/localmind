import { deleteMemory, listMemory, upsertMemory } from "../db/queries";
import type { Tool } from "./types";

export const memoryTool: Tool = {
  actionType: "memory_read",
  classify: (i) => (i.operation === "read" ? "memory_read" : "memory_write"),
  preview: (i) => {
    if (i.operation === "write") return `Remember: ${i.key} = ${i.value}`;
    if (i.operation === "delete") return `Forget memory item: ${i.key}`;
    return "Read all memory";
  },
  definition: {
    name: "memory",
    description:
      "Read, write, or delete persistent facts the assistant remembers across conversations. Operations: read, write, delete.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "write", "delete"] },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const op = input.operation;
    if (op === "read") {
      const items = listMemory();
      return {
        ok: true,
        output: items.length
          ? items.map((i) => `- ${i.key}: ${i.value}`).join("\n")
          : "(no memory stored)",
        summary: `read ${items.length} memory item(s)`,
      };
    }
    if (op === "write") {
      const key = String(input.key || "").trim();
      const value = String(input.value || "").trim();
      if (!key || !value) return { ok: false, output: "key and value required" };
      const { getConversation } = require("../db/queries");
      const owner = getConversation(ctx.conversationId)?.owner_user_id || undefined;
      const item = upsertMemory(key, value, ctx.conversationId, owner);
      return { ok: true, output: `Saved: ${item.key}`, summary: `saved memory "${item.key}"` };
    }
    if (op === "delete") {
      const items = listMemory();
      const match = items.find((i) => i.key === String(input.key || ""));
      if (!match) return { ok: false, output: "Key not found" };
      deleteMemory(match.id);
      return { ok: true, output: `Deleted: ${match.key}`, summary: `deleted memory "${match.key}"` };
    }
    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
