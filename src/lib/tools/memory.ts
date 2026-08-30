import { deleteMemory, getConversation, listMemory, upsertMemory } from "../db/queries";
import type { Tool } from "./types";

export const memoryTool: Tool = {
  actionType: "memory_read",
  classify: (i) => (i.operation === "read" ? "memory_read" : "memory_write"),
  preview: (i) => {
    if (i.operation === "write") return `Remember: ${i.key} = ${i.value}`;
    if (i.operation === "delete") return `Forget memory item: ${i.key}`;
    return "Read all memory";
  },
  version: "2",
  // Never cache memory reads: the user can add/replace a fact during the same
  // turn, and a personal assistant must observe that write immediately.
  cacheable: () => false,
  definition: {
    name: "memory",
    description:
      "Read, write, or delete durable facts the assistant remembers across conversations. Save explicit remember/forget requests and stable preferences, people, projects, or environment details that will clearly help later. Never store passwords, tokens, sensitive document contents, guesses, or transient chat. Operations: read, write, delete (list is an alias for read).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "write", "delete", "list"] },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    // Small models often invent ops like "list" / "record" / "save".
    const raw = String(input.operation || "");
    const op =
      raw === "list" || raw === "get" || raw === "fetch"
        ? "read"
        : raw === "record" || raw === "save" || raw === "set" || raw === "add"
        ? "write"
        : raw === "remove" || raw === "forget"
        ? "delete"
        : raw;
    const owner = getConversation(ctx.conversationId)?.owner_user_id || undefined;
    if (op === "read") {
      const items = listMemory(owner);
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
      const item = upsertMemory(key, value, ctx.conversationId, owner);
      return { ok: true, output: `Saved: ${item.key}`, summary: `saved memory "${item.key}"` };
    }
    if (op === "delete") {
      const items = listMemory(owner);
      const match = items.find((i) => i.key === String(input.key || ""));
      if (!match) return { ok: false, output: "Key not found" };
      deleteMemory(match.id);
      return { ok: true, output: `Deleted: ${match.key}`, summary: `deleted memory "${match.key}"` };
    }
    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
